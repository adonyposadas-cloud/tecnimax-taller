/**
 * admin.js — Tablero del Admin (Fase 3c)
 *
 * Secciones:
 *  1. KPIs en vivo (vehículos en taller, en proceso, pausados, ingresos hoy, completados, tiempo prom.)
 *  2. Alertas de servicios sospechosos (prominentes)
 *  3. Tablero de técnicos en vivo (estado de cada uno)
 *  4. Productividad por técnico (en el rango)
 *  5. Cancelaciones (en el rango)
 *
 * Selector de rango: Hoy / Esta semana / Este mes
 *
 * Realtime: ordenes, servicios_orden, historial_pausas, cancelaciones_orden
 */

const Admin = {

  // ========================================================================
  // CONFIG: Horario laboral del taller (hora local)
  // Cualquier intervalo de trabajo se acota a este horario en cada día.
  // Si un técnico olvida pausar al final de la jornada, los minutos fuera
  // del horario NO se cuentan como tiempo activo. Editá estos valores si
  // cambia el horario operativo del taller.
  //
  // INTERVALO_MAX_MIN: tope de duración para un intervalo activo continuo
  // sin pausa registrada. Refleja la realidad: nadie trabaja >4h continuas
  // sin pausa. Si pasó eso, se asume olvido y se trunca.
  // ========================================================================
  CONFIG_HORARIO_LABORAL: {
    horaInicio: 7,     // 07:00
    horaFin: 18,       // 18:00
    INTERVALO_MAX_MIN: 240,  // 4 horas
    JORNADA_PAGADA_MIN: 480, // 8 horas (jornada fija pagada al técnico)
  },

  state: {
    profile: null,
    rango: 'hoy',  // 'hoy' | 'semana' | 'mes' | 'dia'
    fechaDesde: null,
    fechaHasta: null,
    fechaEspecifica: null,  // 'YYYY-MM-DD' cuando rango = 'dia'

    ordenes: [],
    servicios: [],
    pausas: [],
    cancelaciones: [],
    usuarios: [],
    serviciosCatalogo: [],
    alertasMtto: [],  // Alertas de mantenimiento KM (Fase 4b)

    realtimeChannel: null,
    pollingInterval: null,
    cronometros: {},  // { tecnicoId_servicioId: intervalId }
    cronometrosPausa: {},  // { servicioId: intervalId } - cronómetros de pausas en admin
    tecnicosExpandidos: new Set(),  // ids de técnicos con productividad expandida
  },

  // ==================== INIT ====================
  async init() {
    Utils.log('Iniciando panel admin...');

    const profile = await Auth.requireAuth();
    if (!profile) return;

    if (!['admin', 'jefe_pista'].includes(profile.rol)) {
      alert('No tienes permisos para ver este panel.');
      window.location.href = 'tecnico.html';
      return;
    }

    this.state.profile = profile;
    document.getElementById('user-nombre-header').textContent = profile.nombre || 'Administración';
    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

    // Bind del botón maestro "Cerrar día de todos"
    const btnCerrarTodos = document.getElementById('btn-cerrar-dia-todos');
    if (btnCerrarTodos) {
      btnCerrarTodos.addEventListener('click', () => this.cerrarDiaTodosRemoto());
    }

    // Si entra el jefe (no admin), mostrar "Volver al panel" y ocultar "Configuración"
    if (profile.rol === 'jefe_pista') {
      const btnVolver = document.getElementById('btn-volver-jefe');
      const btnConfig = document.getElementById('btn-config-admin');
      if (btnVolver) btnVolver.hidden = false;
      if (btnConfig) btnConfig.hidden = true;
    }

    this.calcularRango();
    this.actualizarRangoInfo();
    this.bindEventos();

    await this.cargarTodo();
    this.activarRealtime();
  },

  bindEventos() {
    document.querySelectorAll('.rango-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const r = tab.dataset.rango;

        // Caso especial: tab "dia" abre el calendario custom (modal)
        if (r === 'dia') {
          this.abrirCalendario();
          return;
        }

        if (r === this.state.rango) return;

        document.querySelectorAll('.rango-tab').forEach(t => t.classList.remove('rango-active'));
        tab.classList.add('rango-active');
        this.state.rango = r;
        this.state.fechaEspecifica = null;

        // Resetear texto del botón "Día..." si se sale de ese modo
        const tabDiaReset = document.querySelector('.rango-tab[data-rango="dia"]');
        if (tabDiaReset) tabDiaReset.textContent = '📅 Día...';

        this.calcularRango();
        this.actualizarRangoInfo();
        this.cargarTodo();
      });
    });

    // ====== Calendario custom: bind eventos del modal ======
    const calBackdrop = document.getElementById('cal-modal-backdrop');
    const calCancel = document.getElementById('cal-cancel');
    const calToday = document.getElementById('cal-today');
    const calPrev = document.getElementById('cal-prev');
    const calNext = document.getElementById('cal-next');
    if (calBackdrop) calBackdrop.addEventListener('click', () => this.cerrarCalendario());
    if (calCancel) calCancel.addEventListener('click', () => this.cerrarCalendario());
    if (calToday) calToday.addEventListener('click', () => {
      const hoy = new Date();
      const iso = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
      this.seleccionarDiaCalendario(iso);
    });
    if (calPrev) calPrev.addEventListener('click', () => this.navegarMes(-1));
    if (calNext) calNext.addEventListener('click', () => this.navegarMes(1));

    document.getElementById('btn-toggle-alertas').addEventListener('click', () => {
      const lista = document.getElementById('alerta-lista');
      const btn = document.getElementById('btn-toggle-alertas');
      if (lista.hidden) {
        lista.hidden = false;
        btn.textContent = 'Ocultar';
      } else {
        lista.hidden = true;
        btn.textContent = 'Ver';
      }
    });

    // KPIs cliqueables (excepto "Tiempo promedio" que no lleva detalle)
    document.querySelectorAll('.kpi-card[data-kpi]').forEach(card => {
      card.addEventListener('click', () => {
        this.abrirKpiModal(card.dataset.kpi);
      });
    });

    // Cerrar KPI modal
    document.getElementById('kpi-modal-close').addEventListener('click', () => this.cerrarKpiModal());
    document.getElementById('kpi-modal-backdrop').addEventListener('click', () => this.cerrarKpiModal());

    // Esc cierra modales
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.cerrarKpiModal();
        this.cerrarCalendario();
      }
    });

    // Refresh al volver a la pestaña (visibilitychange)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        Utils.log('Pestaña visible, refrescando datos...');
        this.cargarTodo();
      }
    });
  },

  // ==================== RANGOS ====================
  calcularRango() {
    const ahora = new Date();
    const desde = new Date(ahora);
    let hasta = new Date(ahora);

    if (this.state.rango === 'hoy') {
      desde.setHours(0, 0, 0, 0);
      // hasta = ahora
    } else if (this.state.rango === 'semana') {
      // Lunes 00:00 de esta semana
      const diaSemana = desde.getDay();  // 0=domingo, 1=lunes...
      const diff = diaSemana === 0 ? 6 : diaSemana - 1;
      desde.setDate(desde.getDate() - diff);
      desde.setHours(0, 0, 0, 0);
      // hasta = ahora
    } else if (this.state.rango === 'mes') {
      desde.setDate(1);
      desde.setHours(0, 0, 0, 0);
      // hasta = ahora
    } else if (this.state.rango === 'dia' && this.state.fechaEspecifica) {
      // Día específico seleccionado del calendario.
      // fechaEspecifica viene como 'YYYY-MM-DD' (input type=date) o ISO.
      const partes = String(this.state.fechaEspecifica).split('T')[0].split('-');
      const y = parseInt(partes[0], 10);
      const m = parseInt(partes[1], 10) - 1;
      const d = parseInt(partes[2], 10);
      desde.setFullYear(y, m, d);
      desde.setHours(0, 0, 0, 0);
      hasta = new Date(desde);
      hasta.setHours(23, 59, 59, 999);
    }

    // FIX: garantizar que `hasta` JAMÁS sea futuro. Esto se aplica a TODOS los
    // filtros como salvavidas, no solo a "día específico". Si el reloj de la
    // máquina se desincroniza un poco o si el filtro "día" apunta al día actual,
    // `hasta` no debe rebasar "ahora", o si no estaríamos contando tiempo que
    // todavía no ha ocurrido.
    if (hasta > ahora) hasta = ahora;

    this.state.fechaDesde = desde.toISOString();
    this.state.fechaHasta = hasta.toISOString();

    // Labels en las secciones
    const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    let labelTexto;
    if (this.state.rango === 'hoy') labelTexto = 'hoy';
    else if (this.state.rango === 'semana') labelTexto = 'esta semana';
    else if (this.state.rango === 'mes') labelTexto = 'este mes';
    else if (this.state.rango === 'dia') labelTexto = fmt(desde);
    else labelTexto = '—';

    const lblProd = document.getElementById('prod-rango-label');
    const lblCanc = document.getElementById('canc-rango-label');
    if (lblProd) lblProd.textContent = labelTexto;
    if (lblCanc) lblCanc.textContent = labelTexto;
  },

  actualizarRangoInfo() {
    const desde = new Date(this.state.fechaDesde);
    const hasta = new Date(this.state.fechaHasta);
    const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    const el = document.getElementById('rango-info');
    if (!el) return;
    if (this.state.rango === 'dia') {
      el.textContent = `Día ${fmt(desde)}`;
    } else if (this.state.rango === 'hoy') {
      el.textContent = `Hoy ${fmt(desde)}`;
    } else {
      el.textContent = `Desde ${fmt(desde)}`;
    }
  },

  // ==================== CALENDARIO CUSTOM ====================
  // Estado del calendario: qué mes se está viendo y qué fecha está seleccionada.
  // Se inicializa lazy la primera vez que se abre el modal.
  _calState: {
    viewYear: null,
    viewMonth: null,  // 0-11
    selected: null,   // 'YYYY-MM-DD' o null
  },

  abrirCalendario() {
    const hoy = new Date();
    let base;
    if (this.state.fechaEspecifica) {
      const partes = String(this.state.fechaEspecifica).split('-');
      base = new Date(parseInt(partes[0],10), parseInt(partes[1],10)-1, parseInt(partes[2],10));
    } else {
      base = hoy;
    }
    this._calState = {
      viewYear: base.getFullYear(),
      viewMonth: base.getMonth(),
      selected: this.state.fechaEspecifica || null,
    };
    this.renderCalendario();
    const modal = document.getElementById('cal-modal');
    if (modal) modal.hidden = false;
  },

  cerrarCalendario() {
    const modal = document.getElementById('cal-modal');
    if (modal) modal.hidden = true;
  },

  navegarMes(delta) {
    let m = this._calState.viewMonth + delta;
    let y = this._calState.viewYear;
    if (m < 0) { m = 11; y--; }
    else if (m > 11) { m = 0; y++; }
    this._calState.viewMonth = m;
    this._calState.viewYear = y;
    this.renderCalendario();
  },

  renderCalendario() {
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const titulo = document.getElementById('cal-title');
    const cont = document.getElementById('cal-days');
    if (!titulo || !cont) return;

    const y = this._calState.viewYear;
    const m = this._calState.viewMonth;
    titulo.textContent = `${meses[m]} de ${y}`;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const hoyIso = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;

    cont.innerHTML = '';

    // Día de la semana del primer día del mes (0 = domingo ... 6 = sábado)
    const primerDia = new Date(y, m, 1);
    const firstWeekday = primerDia.getDay();

    // Días del mes anterior visibles (en gris) para llenar la primera fila
    const ultDiaMesAnterior = new Date(y, m, 0).getDate();
    for (let i = firstWeekday - 1; i >= 0; i--) {
      const dia = ultDiaMesAnterior - i;
      const fecha = new Date(y, m - 1, dia);
      cont.appendChild(this._crearCeldaDia(fecha, true, hoy, hoyIso));
    }

    // Días del mes actual
    const diasMes = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= diasMes; d++) {
      const fecha = new Date(y, m, d);
      cont.appendChild(this._crearCeldaDia(fecha, false, hoy, hoyIso));
    }

    // Rellenar última fila con días del mes siguiente
    const total = cont.children.length;
    const filas = Math.ceil(total / 7);
    const objetivo = filas * 7;
    let dnext = 1;
    while (cont.children.length < objetivo) {
      const fecha = new Date(y, m + 1, dnext);
      cont.appendChild(this._crearCeldaDia(fecha, true, hoy, hoyIso));
      dnext++;
    }
  },

  _crearCeldaDia(fecha, esOtroMes, hoy, hoyIso) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-day';
    btn.textContent = fecha.getDate();

    const iso = `${fecha.getFullYear()}-${String(fecha.getMonth()+1).padStart(2,'0')}-${String(fecha.getDate()).padStart(2,'0')}`;
    btn.dataset.fecha = iso;

    if (esOtroMes) btn.classList.add('cal-other-month');
    if (iso === hoyIso) btn.classList.add('cal-today');
    if (this._calState.selected === iso) btn.classList.add('cal-selected');

    // Días futuros: deshabilitados
    if (fecha > hoy) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => this.seleccionarDiaCalendario(iso));
    }

    return btn;
  },

  seleccionarDiaCalendario(iso) {
    if (!iso) return;

    // Validar que no sea futura (defensivo)
    const partes = iso.split('-');
    const seleccionada = new Date(parseInt(partes[0],10), parseInt(partes[1],10)-1, parseInt(partes[2],10));
    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999);
    if (seleccionada > hoy) return;

    this.state.rango = 'dia';
    this.state.fechaEspecifica = iso;

    // Marcar el tab "dia" como activo
    document.querySelectorAll('.rango-tab').forEach(t => t.classList.remove('rango-active'));
    const tabDia = document.querySelector('.rango-tab[data-rango="dia"]');
    if (tabDia) {
      tabDia.classList.add('rango-active');
      const fmt = `${String(seleccionada.getDate()).padStart(2,'0')}/${String(seleccionada.getMonth()+1).padStart(2,'0')}`;
      tabDia.textContent = `📅 ${fmt}`;
    }

    this.cerrarCalendario();
    this.calcularRango();
    this.actualizarRangoInfo();
    this.cargarTodo();
  },

  // ==================== CARGA DE DATOS ====================
  async cargarTodo() {
    try {
      // Recalcular rango antes de cargar para que fechaHasta refleje el "ahora" real.
      // Sin esto, el polling y visibilitychange usan una fechaHasta congelada al
      // momento de cargar la página, lo que hace que servicios completados después
      // de ese instante no entren en KPIs ni Productividad hasta cambiar de pestaña.
      this.calcularRango();
      this.actualizarRangoInfo();

      await Promise.all([
        this.cargarCatalogo(),
        this.cargarUsuarios(),
        this.cargarOrdenes(),
        this.cargarServicios(),
        this.cargarPausas(),
        this.cargarCancelaciones(),
        this.cargarAlertasMtto(),
      ]);

      this.renderKPIs();
      this.renderAlertas();
      this.renderTecnicos();
      this.renderProductividad();
      this.renderCancelaciones();
      this.renderAlertasMttoKpi();
    } catch (err) {
      Utils.log('Error cargando todo:', err);
    }
  },

  async cargarCatalogo() {
    const { data, error } = await supabaseClient
      .from('catalogo_servicios')
      .select('id, nombre, tiempo_promedio_min');
    if (error) throw error;
    this.state.serviciosCatalogo = data || [];
  },

  async cargarUsuarios() {
    const { data, error } = await supabaseClient
      .from('usuarios')
      .select('id, nombre, codigo, rol, activo')
      .eq('activo', true);
    if (error) throw error;
    this.state.usuarios = data || [];
  },

  async cargarOrdenes() {
    // Cargamos todas las órdenes (para KPIs en taller que son live)
    // Y filtramos por rango para los counts del rango
    const { data, error } = await supabaseClient
      .from('ordenes')
      .select('num_orden, placa, prioridad, estado, motivo, creada_en, cerrada_en, creada_por, entregada_en, motorista_nombre');
    if (error) throw error;
    this.state.ordenes = data || [];
  },

  async cargarServicios() {
    const { data, error } = await supabaseClient
      .from('servicios_orden')
      .select('id, num_orden, servicio_id, estado, tecnico_id, hora_inicio, hora_fin, tiempo_real_min, tiempo_asignado_min, sospechoso');
    if (error) throw error;
    this.state.servicios = data || [];
  },

  async cargarPausas() {
    const { data, error } = await supabaseClient
      .from('historial_pausas')
      .select('id, servicio_orden_id, tecnico_id, motivo, hora_pausa, hora_reanudacion');
    if (error) throw error;
    this.state.pausas = data || [];
  },

  async cargarCancelaciones() {
    const { data, error } = await supabaseClient
      .from('cancelaciones_orden')
      .select('id, num_orden, motivo, cancelada_por, cancelada_en')
      .gte('cancelada_en', this.state.fechaDesde)
      .order('cancelada_en', { ascending: false });
    if (error) throw error;
    this.state.cancelaciones = data || [];
  },

  async cargarAlertasMtto() {
    try {
      const { data, error } = await supabaseClient.rpc('f_alertas_flota');
      if (error) throw error;
      this.state.alertasMtto = data || [];
    } catch (err) {
      Utils.log('Error cargando alertas mtto (puede ser BD vieja):', err);
      this.state.alertasMtto = [];
    }
  },

  renderAlertasMttoKpi() {
    const card = document.getElementById('kpi-card-alertas-mtto');
    const valEl = document.getElementById('kpi-alertas-mtto');
    const hintEl = document.getElementById('kpi-alertas-mtto-hint');
    if (!card || !valEl) return;

    const alertas = this.state.alertasMtto || [];
    if (alertas.length === 0) {
      card.hidden = true;
      return;
    }

    const vencidas = alertas.filter(a => a.estado === 'vencido').length;
    const proximas = alertas.filter(a => a.estado === 'proximo').length;

    valEl.textContent = vencidas > 0 ? vencidas : proximas;
    hintEl.textContent = vencidas > 0
      ? `vencida${vencidas !== 1 ? 's' : ''} · ${proximas} próxima${proximas !== 1 ? 's' : ''}`
      : `próxima${proximas !== 1 ? 's' : ''}`;

    if (vencidas === 0) {
      card.classList.add('alertas-solo-proximas');
    } else {
      card.classList.remove('alertas-solo-proximas');
    }
    card.hidden = false;
  },

  // ==================== HELPERS ====================
  segundosPausados(servicioId) {
    return this.state.pausas
      .filter(p => p.servicio_orden_id === servicioId && p.hora_reanudacion !== null)
      .reduce((acc, p) => {
        const dur = (new Date(p.hora_reanudacion) - new Date(p.hora_pausa)) / 1000;
        return acc + Math.max(0, dur);
      }, 0);
  },

  pausaAbierta(servicioId) {
    return this.state.pausas
      .filter(p => p.servicio_orden_id === servicioId && p.hora_reanudacion === null)
      .sort((a, b) => new Date(b.hora_pausa) - new Date(a.hora_pausa))[0] || null;
  },

  // FIX: Devuelve la última pausa registrada del servicio (abierta o cerrada).
  // Se usa para servicios en estado "pausado" cuando no hay pausa abierta
  // (caso "Cerrar día": la pausa se cerró pero el estado quedó pausado).
  // En ese caso el último período activo terminó cuando empezó esa última pausa.
  ultimaPausaDelServicio(servicioId) {
    return this.state.pausas
      .filter(p => p.servicio_orden_id === servicioId && p.hora_pausa)
      .sort((a, b) => new Date(b.hora_pausa) - new Date(a.hora_pausa))[0] || null;
  },

  // ===== PAUSA REMOTA POR ADMIN/JEFE (motivo: ausente) =====
  async pausarServicioRemoto(servicioId, tecnicoId) {
    // Verificar permisos
    const rol = this.state.profile?.rol;
    if (!['admin', 'jefe_pista'].includes(rol)) {
      alert('No tienes permiso para pausar servicios remotamente.');
      return;
    }

    // Verificar que el servicio sigue activo (defensivo)
    const servicio = this.state.servicios.find(s => s.id === servicioId);
    if (!servicio) {
      alert('El servicio ya no existe. Refresca la página.');
      return;
    }
    if (servicio.estado !== 'en_progreso') {
      alert('Este servicio ya no está activo. Refresca la página.');
      return;
    }

    // Verificar que NO hay pausa abierta ya (defensivo)
    const yaPausado = this.pausaAbierta(servicioId);
    if (yaPausado) {
      alert('Este servicio ya está pausado.');
      return;
    }

    const tecnico = this.state.usuarios.find(u => u.id === tecnicoId);
    const nombreTec = tecnico?.nombre || 'el técnico';
    const orden = this.state.ordenes.find(o => o.num_orden === servicio.num_orden);
    const placa = orden?.placa || '—';
    const nomServicio = this.nombreServicio(servicio.servicio_id);

    const ok = confirm(
      `¿Pausar el cronómetro de ${nombreTec}?\n\n` +
      `Servicio: ${nomServicio}\n` +
      `Vehículo: ${placa}\n` +
      `Motivo: ausente del plantel\n\n` +
      `El técnico podrá reanudarlo desde su dispositivo cuando regrese.`
    );
    if (!ok) return;

    try {
      // 1. Insertar pausa con motivo 'ausente' y registrar quién pausó
      const { error: errPausa } = await supabaseClient
        .from('historial_pausas')
        .insert({
          servicio_orden_id: servicioId,
          tecnico_id: tecnicoId,
          motivo: 'ausente',
          hora_pausa: new Date().toISOString(),
          pausado_por: this.state.profile.id,
        });
      if (errPausa) throw errPausa;

      // 2. Cambiar estado del servicio a 'pausado'
      const { error: errServ } = await supabaseClient
        .from('servicios_orden')
        .update({ estado: 'pausado' })
        .eq('id', servicioId);
      if (errServ) throw errServ;

      Utils.log(`Servicio ${servicioId} pausado remotamente por ${rol} (${this.state.profile.nombre})`);
      // El realtime/polling refrescará la UI automáticamente
    } catch (e) {
      console.error('Error pausando remotamente:', e);
      alert('Error al pausar el servicio: ' + (e.message || 'desconocido'));
    }
  },

  // ===== CERRAR DÍA DE TODOS: cerrar todas las pausas abiertas con un click =====
  // FIX (Mejora C): además de cerrar pausas abiertas, también pausa los servicios
  // en estado 'en_progreso' creando una pausa de motivo 'cierre_dia'. Esto evita
  // que servicios olvidados sigan corriendo durante la noche y dañen las métricas.
  async cerrarDiaTodosRemoto() {
    const rol = this.state.profile?.rol;
    if (!['admin', 'jefe_pista'].includes(rol)) {
      alert('No tienes permiso para cerrar día.');
      return;
    }

    // 1. Recolectar TODAS las pausas abiertas en memoria
    const pausasAbiertas = (this.state.pausas || []).filter(p => !p.hora_reanudacion);

    // 2. Recolectar TODOS los servicios en_progreso (sin pausa abierta)
    const serviciosActivos = (this.state.servicios || []).filter(s => s.estado === 'en_progreso');

    if (pausasAbiertas.length === 0 && serviciosActivos.length === 0) {
      alert('No hay pausas abiertas ni servicios en progreso para cerrar.');
      return;
    }

    // Preparar resumen para el confirm
    const lineasPausas = pausasAbiertas.map(p => {
      const tec = this.state.usuarios.find(u => u.id === p.tecnico_id);
      const serv = this.state.servicios.find(s => s.id === p.servicio_orden_id);
      const orden = serv ? this.state.ordenes.find(o => o.num_orden === serv.num_orden) : null;
      const placa = orden?.placa || '—';
      return `  • ${tec?.nombre || 'desconocido'} — ${placa} (pausa: ${p.motivo})`;
    });

    const lineasActivos = serviciosActivos.map(s => {
      const tec = this.state.usuarios.find(u => u.id === s.tecnico_id);
      const orden = this.state.ordenes.find(o => o.num_orden === s.num_orden);
      const placa = orden?.placa || '—';
      return `  • ${tec?.nombre || 'desconocido'} — ${placa} (en progreso → se pausará)`;
    });

    const todasLasLineas = [...lineasPausas, ...lineasActivos];
    const totalAcciones = pausasAbiertas.length + serviciosActivos.length;

    const ok = confirm(
      `¿Cerrar el día? Se realizarán ${totalAcciones} acción(es):\n\n` +
      todasLasLineas.join('\n') + '\n\n' +
      `Esto detiene todos los cronómetros AHORA.\n` +
      `Los servicios quedan pausados. Mañana los técnicos los reanudan y continúan.`
    );
    if (!ok) return;

    try {
      const ahora = new Date().toISOString();

      // 1. Cerrar todas las pausas abiertas
      if (pausasAbiertas.length > 0) {
        const ids = pausasAbiertas.map(p => p.id);
        const { error: errPausas } = await supabaseClient
          .from('historial_pausas')
          .update({ hora_reanudacion: ahora })
          .in('id', ids);
        if (errPausas) throw errPausas;
      }

      // 2. Crear pausa de cierre de día para cada servicio en_progreso
      //    y cambiar su estado a 'pausado'
      if (serviciosActivos.length > 0) {
        const nuevasPausas = serviciosActivos.map(s => ({
          servicio_orden_id: s.id,
          tecnico_id: s.tecnico_id,
          hora_pausa: ahora,
          // Inmediatamente cerrada con la misma hora -> 0 minutos de pausa real,
          // pero deja registro de que el día se cerró aquí.
          hora_reanudacion: ahora,
          motivo: 'cierre_dia',
        }));

        const { error: errInsert } = await supabaseClient
          .from('historial_pausas')
          .insert(nuevasPausas);
        if (errInsert) throw errInsert;

        // Cambiar estado de los servicios a 'pausado' para que mañana
        // aparezcan listos para reanudar
        const idsServicios = serviciosActivos.map(s => s.id);
        const { error: errUpd } = await supabaseClient
          .from('servicios_orden')
          .update({ estado: 'pausado' })
          .in('id', idsServicios);
        if (errUpd) throw errUpd;
      }

      Utils.log(`Cerrado día masivo: ${pausasAbiertas.length} pausas + ${serviciosActivos.length} en_progreso por ${rol}`);
      alert(`✅ Día cerrado: ${pausasAbiertas.length} pausa(s) cerradas + ${serviciosActivos.length} servicio(s) pausados.`);
    } catch (e) {
      console.error('Error cerrando día masivo:', e);
      alert('Error al cerrar el día: ' + (e.message || 'desconocido'));
    }
  },

  async reanudarServicioRemoto(servicioId) {
    const rol = this.state.profile?.rol;
    if (!['admin', 'jefe_pista'].includes(rol)) {
      alert('No tienes permiso para reanudar servicios remotamente.');
      return;
    }

    const pausa = this.pausaAbierta(servicioId);
    if (!pausa) {
      // No hay pausa abierta. Verificar si el servicio está pausado por cierre de día anterior.
      // Si sí, hacemos lo equivalente: detectar gap y reanudar.
      const servicio = this.state.servicios.find(s => s.id === servicioId);
      if (!servicio || servicio.estado !== 'pausado') {
        alert('Este servicio no está pausado.');
        return;
      }
      const ok = confirm('Este servicio fue cerrado el día anterior. ¿Reanudar ahora?');
      if (!ok) return;
      try {
        // Crear pausa automática que cubre el gap si > 4h
        await this.crearPausaAutomaticaSiGap(servicioId);
        // Volver el servicio a 'en_progreso'
        const { error: errServ } = await supabaseClient
          .from('servicios_orden')
          .update({ estado: 'en_progreso' })
          .eq('id', servicioId);
        if (errServ) throw errServ;
        Utils.log(`Servicio ${servicioId} reanudado por ${rol} desde día anterior`);
      } catch (e) {
        console.error('Error reanudando desde día anterior:', e);
        alert('Error al reanudar: ' + (e.message || 'desconocido'));
      }
      return;
    }
    // Solo reanudar pausas de motivo 'ausente' desde aquí
    // (las otras pausas las maneja el técnico desde su pantalla)
    if (pausa.motivo !== 'ausente') {
      alert('Esta pausa no fue por ausencia. Debe reanudarla el técnico.');
      return;
    }

    const ok = confirm('¿Reanudar el servicio? El cronómetro vuelve a correr.');
    if (!ok) return;

    try {
      // 1. Cerrar la pausa (fijar hora_reanudacion)
      const { error: errPausa } = await supabaseClient
        .from('historial_pausas')
        .update({ hora_reanudacion: new Date().toISOString() })
        .eq('id', pausa.id);
      if (errPausa) throw errPausa;

      // 2. Volver el servicio a 'en_progreso'
      const { error: errServ } = await supabaseClient
        .from('servicios_orden')
        .update({ estado: 'en_progreso' })
        .eq('id', servicioId);
      if (errServ) throw errServ;

      Utils.log(`Servicio ${servicioId} reanudado remotamente por ${rol}`);
    } catch (e) {
      console.error('Error reanudando remotamente:', e);
      alert('Error al reanudar el servicio: ' + (e.message || 'desconocido'));
    }
  },

  // Crea una pausa "automática" si detecta que pasó >4h desde la última actividad
  // del servicio. Caso típico: cierre de día anterior con botón "⏹".
  // (Misma lógica que orden-detalle.js para casos donde admin/jefe reanuda)
  async crearPausaAutomaticaSiGap(sid) {
    const GAP_THRESHOLD_HORAS = 4;
    const GAP_MS = GAP_THRESHOLD_HORAS * 60 * 60 * 1000;

    try {
      const { data: serv, error: e1 } = await supabaseClient
        .from('servicios_orden')
        .select('id, tecnico_id, hora_inicio')
        .eq('id', sid)
        .single();
      if (e1) throw e1;
      if (!serv || !serv.hora_inicio) return;

      const { data: pausas, error: e2 } = await supabaseClient
        .from('historial_pausas')
        .select('id, hora_pausa, hora_reanudacion')
        .eq('servicio_orden_id', sid)
        .not('hora_reanudacion', 'is', null)
        .order('hora_reanudacion', { ascending: false });
      if (e2) throw e2;

      let ultimaActividad;
      if (pausas && pausas.length > 0) {
        ultimaActividad = new Date(pausas[0].hora_reanudacion);
      } else {
        ultimaActividad = new Date(serv.hora_inicio);
      }

      const ahora = new Date();
      const gapMs = ahora - ultimaActividad;

      if (gapMs < GAP_MS) {
        Utils.log(`Gap de ${Math.round(gapMs / 60000)} min < ${GAP_THRESHOLD_HORAS}h, sin pausa automática.`);
        return;
      }

      Utils.log(`Detectado gap de ${Math.round(gapMs / 3600000)}h. Creando pausa automática.`);

      const { error: e3 } = await supabaseClient
        .from('historial_pausas')
        .insert({
          servicio_orden_id: sid,
          tecnico_id: serv.tecnico_id,
          motivo: 'ausente',
          hora_pausa: ultimaActividad.toISOString(),
          hora_reanudacion: ahora.toISOString(),
        });
      if (e3) throw e3;

      Utils.log('Pausa automática creada correctamente.');
    } catch (err) {
      Utils.log('Error creando pausa automática (no crítico):', err);
    }
  },

  // ===== CERRAR DÍA: cierra pausa 'ausente' pero deja el servicio en 'pausado' =====
  // Caso: el técnico no vuelve hoy. Cerramos la pausa para que el cronómetro no corra
  // toda la noche. El servicio queda 'pausado' y mañana el técnico lo reanuda.
  async cerrarDiaServicioRemoto(servicioId, tecnicoId) {
    const rol = this.state.profile?.rol;
    if (!['admin', 'jefe_pista'].includes(rol)) {
      alert('No tienes permiso para cerrar día remotamente.');
      return;
    }

    const pausa = this.pausaAbierta(servicioId);
    if (!pausa) {
      alert('Este servicio no tiene una pausa abierta.');
      return;
    }
    // Permitir cerrar día para CUALQUIER motivo (ausente, repuesto, cambio_unidad, personal, reasignacion_jefe)

    const tecnico = this.state.usuarios.find(u => u.id === tecnicoId);
    const nombreTec = tecnico?.nombre || 'el técnico';

    const ok = confirm(
      `¿Cerrar el día de ${nombreTec}?\n\n` +
      `Esto detiene el cronómetro de pausa AHORA mismo.\n` +
      `El servicio queda PAUSADO. Mañana cuando el técnico vuelva,\n` +
      `podrá reanudarlo desde su dispositivo y continuar donde quedó.\n\n` +
      `Usa esta opción cuando confirmes que el técnico NO regresa hoy.`
    );
    if (!ok) return;

    try {
      // 1. Cerrar la pausa con timestamp actual
      const { error: errPausa } = await supabaseClient
        .from('historial_pausas')
        .update({ hora_reanudacion: new Date().toISOString() })
        .eq('id', pausa.id);
      if (errPausa) throw errPausa;

      // 2. NO cambiar estado del servicio — sigue en 'pausado'
      //    Esto es CLAVE: la pausa cierra (cronómetro se detiene) pero el servicio
      //    queda marcado como pausado para que mañana se vea como tal.

      Utils.log(`Día cerrado para servicio ${servicioId} por ${rol} (${this.state.profile.nombre})`);
    } catch (e) {
      console.error('Error cerrando día:', e);
      alert('Error al cerrar el día: ' + (e.message || 'desconocido'));
    }
  },

  enRango(fechaIso) {
    if (!fechaIso) return false;
    const f = new Date(fechaIso);
    return f >= new Date(this.state.fechaDesde) && f <= new Date(this.state.fechaHasta);
  },

  // Suma de minutos de pausas registradas del técnico, dentro de la ventana [desde, hasta]
  // Solo considera pausas que TERMINARON (tienen hora_fin) — pausas activas no se cuentan.
  calcularPausasTecnicoEnRango(tecnicoId, desde, hasta) {
    if (!Array.isArray(this.state.pausas) || this.state.pausas.length === 0) return 0;
    let total = 0;
    this.state.pausas.forEach(p => {
      if (p.tecnico_id !== tecnicoId) return;
      if (!p.hora_pausa || !p.hora_reanudacion) return;
      const ini = new Date(p.hora_pausa);
      const fin = new Date(p.hora_reanudacion);
      // Intersección con la ventana [desde, hasta]
      const a = ini > desde ? ini : desde;
      const b = fin < hasta ? fin : hasta;
      if (b > a) {
        total += Math.round((b - a) / 60000);
      }
    });
    return total;
  },

  // Suma de minutos de pausas CERRADAS de un servicio específico, dentro de [desde, hasta]
  // Usado para calcular tiempo trabajado parcial de servicios pausados o en progreso.
  pausasPreviasMinutos(servicioId, desde, hasta) {
    if (!Array.isArray(this.state.pausas) || this.state.pausas.length === 0) return 0;
    let total = 0;
    this.state.pausas.forEach(p => {
      if (p.servicio_orden_id !== servicioId) return;
      if (!p.hora_pausa || !p.hora_reanudacion) return;  // solo cerradas
      const ini = new Date(p.hora_pausa);
      const fin = new Date(p.hora_reanudacion);
      const a = ini > desde ? ini : desde;
      const b = fin < hasta ? fin : hasta;
      if (b > a) {
        total += Math.round((b - a) / 60000);
      }
    });
    return total;
  },

  // Formatea minutos a "Xh Ym" o "Y min"
  formatMin(min) {
    if (!min || min === 0) return '0 min';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  },

  nombreUsuario(uid) {
    const u = this.state.usuarios.find(x => x.id === uid);
    return u ? u.nombre : '—';
  },

  nombreServicio(sid) {
    const s = this.state.serviciosCatalogo.find(x => x.id === sid);
    return s ? s.nombre : 'Servicio';
  },

  // ==================== 1. KPIs ====================
  renderKPIs() {
    // En taller AHORA = órdenes abierta + en_progreso (no completadas, no canceladas)
    const enTaller = this.state.ordenes.filter(
      o => o.estado === 'abierta' || o.estado === 'en_progreso'
    ).length;

    // En proceso (live): servicios en estado en_progreso
    const enProceso = this.state.servicios.filter(s => s.estado === 'en_progreso').length;

    // Pausados (live)
    const pausados = this.state.servicios.filter(s => s.estado === 'pausado').length;

    // Ingresos en el rango = órdenes creadas en el rango
    const ingresos = this.state.ordenes.filter(o => this.enRango(o.creada_en)).length;

    // Completados en el rango = órdenes completadas en el rango
    const completados = this.state.ordenes.filter(
      o => o.estado === 'completada' && this.enRango(o.cerrada_en)
    ).length;

    // Tiempo promedio servicio completado en el rango
    const serviciosCompletados = this.state.servicios.filter(
      s => s.estado === 'completado' && this.enRango(s.hora_fin) && s.tiempo_real_min
    );
    let tiempoProm = '—';
    if (serviciosCompletados.length > 0) {
      const sum = serviciosCompletados.reduce((acc, s) => acc + s.tiempo_real_min, 0);
      const avg = Math.round(sum / serviciosCompletados.length);
      tiempoProm = avg + ' min';
    }

    document.getElementById('kpi-en-taller').textContent = enTaller;
    document.getElementById('kpi-en-proceso').textContent = enProceso;
    document.getElementById('kpi-pausados').textContent = pausados;
    document.getElementById('kpi-ingresos').textContent = ingresos;
    document.getElementById('kpi-completados').textContent = completados;
    document.getElementById('kpi-tiempo-promedio').textContent = tiempoProm;

    // KPI: Pendiente entrega = órdenes completadas que aún no han sido recogidas
    // por un motorista. Es global (no del rango) porque mientras la unidad esté
    // en el taller esperando, debe verse aquí independientemente del filtro.
    const pendientesEntrega = this.state.ordenes.filter(
      o => o.estado === 'completada' && !o.entregada_en
    ).length;
    const elPend = document.getElementById('kpi-pendiente-entrega');
    if (elPend) elPend.textContent = pendientesEntrega;
  },

  // ==================== KPI MODAL DETALLE ====================
  abrirKpiModal(tipo) {
    const titulos = {
      'en-taller': 'Vehículos en taller',
      'en-proceso': 'Servicios en proceso',
      'pausados': 'Servicios pausados',
      'ingresos': 'Órdenes ingresadas',
      'completados': 'Órdenes completadas',
      'pendiente-entrega': 'Pendientes de entrega al motorista',
      'alertas-mtto': 'Alertas de mantenimiento',
    };

    document.getElementById('kpi-modal-title').textContent = titulos[tipo] || 'Detalle';

    let html = '';

    if (tipo === 'alertas-mtto') {
      const alertas = (this.state.alertasMtto || []).slice().sort((a, b) => {
        if (a.estado !== b.estado) return a.estado === 'vencido' ? -1 : 1;
        return (b.pct_max || 0) - (a.pct_max || 0);
      });
      if (alertas.length === 0) {
        html = '<div class="empty-state"><p>Sin alertas activas.</p></div>';
      } else {
        html = alertas.map(a => {
          const cls = a.estado === 'vencido' ? 'vencido' : 'proximo';
          let detalle = '';
          if (a.km_recorridos != null && a.intervalo_km) {
            detalle = `${a.km_recorridos}/${a.intervalo_km} km`;
          } else if (a.dias_transcurridos != null && a.intervalo_dias) {
            detalle = `${a.dias_transcurridos}/${a.intervalo_dias} días`;
          }
          const gpsHint = a.km_gps_desactualizado ? ' ⏱' : '';
          const pct = a.pct_max != null ? Math.round(a.pct_max) + '%' : '—';
          return `
            <div class="kpi-modal-alerta-row">
              <span class="kpi-modal-alerta-dot ${cls}"></span>
              <div class="kpi-modal-alerta-info">
                <div class="kpi-modal-alerta-placa">${Utils.escapeHtml(a.placa)}${gpsHint} <small style="color:var(--text-muted); font-weight:400;">${Utils.escapeHtml((a.marca || '') + ' ' + (a.modelo || ''))}</small></div>
                <div class="kpi-modal-alerta-serv">${Utils.escapeHtml(a.servicio_nombre)} · ${Utils.escapeHtml(detalle)}</div>
              </div>
              <div class="kpi-modal-alerta-pct ${cls}">${pct}</div>
            </div>
          `;
        }).join('');
      }
      document.getElementById('kpi-modal-list').innerHTML = html;
      document.getElementById('kpi-modal').hidden = false;
      return;
    }

    if (tipo === 'en-taller') {
      const ordenes = this.state.ordenes.filter(o => o.estado === 'abierta' || o.estado === 'en_progreso');
      if (ordenes.length === 0) {
        html = '<div class="empty-state"><p>No hay vehículos en taller.</p></div>';
      } else {
        html = ordenes.map(o => {
          const serviciosOrden = this.state.servicios.filter(s => s.num_orden === o.num_orden);
          const total = serviciosOrden.length;
          const enProc = serviciosOrden.filter(s => s.estado === 'en_progreso').length;
          const pau = serviciosOrden.filter(s => s.estado === 'pausado').length;
          const pen = serviciosOrden.filter(s => s.estado === 'pendiente').length;
          const com = serviciosOrden.filter(s => s.estado === 'completado').length;
          const can = serviciosOrden.filter(s => s.estado === 'cancelado').length;

          const prio = o.prioridad === 'urgente'
            ? '<span class="kpi-badge kpi-badge-urgente">Urgente</span>' : '';

          // Fracción coloreada: completados / total (excluyendo cancelados)
          const totalActivos = total - can;
          const fraccionHtml = totalActivos > 0
            ? `<span class="progreso-fraccion">
                 <span class="prog-num prog-num-ok">${com}</span><span class="prog-sep">/</span><span class="prog-num prog-num-total">${totalActivos}</span>
                 <span class="prog-label">servicios</span>
               </span>`
            : '';

          return `
            <div class="kpi-item" data-orden="${o.num_orden}">
              <div class="kpi-item-info">
                <div class="kpi-item-titulo">
                  ${Utils.escapeHtml(o.placa)} · ${o.num_orden} ${prio}
                  ${fraccionHtml}
                </div>
                <div class="kpi-item-meta">${Utils.escapeHtml(o.motivo || 'Sin motivo')}</div>
                <div class="kpi-item-progress">
                  ${com > 0 ? `<span class="prog-tag prog-completado">✓ ${com} completado${com !== 1 ? 's' : ''}</span>` : ''}
                  ${enProc > 0 ? `<span class="prog-tag prog-en-progreso">▶ ${enProc} en curso</span>` : ''}
                  ${pau > 0 ? `<span class="prog-tag prog-pausado">‖ ${pau} pausado${pau !== 1 ? 's' : ''}</span>` : ''}
                  ${pen > 0 ? `<span class="prog-tag prog-pendiente">⏳ ${pen} pendiente${pen !== 1 ? 's' : ''}</span>` : ''}
                  ${can > 0 ? `<span class="prog-tag prog-cancelado">✗ ${can} cancelado${can !== 1 ? 's' : ''}</span>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    } else if (tipo === 'en-proceso') {
      const servs = this.state.servicios.filter(s => s.estado === 'en_progreso');
      if (servs.length === 0) {
        html = '<div class="empty-state"><p>No hay servicios en proceso.</p></div>';
      } else {
        html = servs.map(s => {
          const orden = this.state.ordenes.find(o => o.num_orden === s.num_orden);
          const placa = orden ? orden.placa : '—';
          const tecnico = this.nombreUsuario(s.tecnico_id);
          const inicio = s.hora_inicio ? this.formatearHora(s.hora_inicio) : '—';
          return `
            <div class="kpi-item" data-orden="${s.num_orden}">
              <div class="kpi-item-info">
                <div class="kpi-item-titulo">${Utils.escapeHtml(this.nombreServicio(s.servicio_id))}</div>
                <div class="kpi-item-meta">${Utils.escapeHtml(placa)} · ${s.num_orden} · ${Utils.escapeHtml(tecnico)} · desde ${inicio}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    } else if (tipo === 'pausados') {
      const servs = this.state.servicios.filter(s => s.estado === 'pausado');
      if (servs.length === 0) {
        html = '<div class="empty-state"><p>No hay servicios pausados.</p></div>';
      } else {
        const motivos = {
          repuesto: 'Esperando repuesto',
          cambio_unidad: 'Cambio de unidad',
          personal: 'Pausa personal',
          reasignacion_jefe: 'Reasignación'
        };
        html = servs.map(s => {
          const orden = this.state.ordenes.find(o => o.num_orden === s.num_orden);
          const placa = orden ? orden.placa : '—';
          const tecnico = this.nombreUsuario(s.tecnico_id);
          const pausa = this.pausaAbierta(s.id);
          const motivo = pausa ? (motivos[pausa.motivo] || pausa.motivo) : '—';
          const detalle = pausa?.detalle_repuesto ? ' — ' + pausa.detalle_repuesto : '';
          const desde = pausa ? this.formatearHora(pausa.hora_pausa) : '—';
          return `
            <div class="kpi-item" data-orden="${s.num_orden}">
              <div class="kpi-item-info">
                <div class="kpi-item-titulo">${Utils.escapeHtml(this.nombreServicio(s.servicio_id))}</div>
                <div class="kpi-item-meta">${Utils.escapeHtml(placa)} · ${s.num_orden} · ${Utils.escapeHtml(tecnico)}</div>
                <div class="kpi-item-meta motivo-text">${Utils.escapeHtml(motivo)}${Utils.escapeHtml(detalle)} · pausado desde ${desde}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    } else if (tipo === 'ingresos') {
      const ords = this.state.ordenes.filter(o => this.enRango(o.creada_en));
      if (ords.length === 0) {
        html = '<div class="empty-state"><p>Sin ingresos en este rango.</p></div>';
      } else {
        html = ords
          .sort((a, b) => new Date(b.creada_en) - new Date(a.creada_en))
          .map(o => {
            const fecha = this.formatearFecha(o.creada_en);
            const quien = this.nombreUsuario(o.creada_por);
            const estados = {
              abierta: 'Abierta', en_progreso: 'En proceso',
              completada: 'Completada', cancelada: 'Cancelada'
            };
            return `
              <div class="kpi-item" data-orden="${o.num_orden}">
                <div class="kpi-item-info">
                  <div class="kpi-item-titulo">${Utils.escapeHtml(o.placa)} · ${o.num_orden}</div>
                  <div class="kpi-item-meta">${fecha} · Por ${Utils.escapeHtml(quien)} · ${estados[o.estado] || o.estado}</div>
                </div>
              </div>
            `;
          }).join('');
      }
    } else if (tipo === 'completados') {
      const ords = this.state.ordenes.filter(o => o.estado === 'completada' && this.enRango(o.cerrada_en));
      if (ords.length === 0) {
        html = '<div class="empty-state"><p>Sin órdenes completadas en este rango.</p></div>';
      } else {
        html = ords
          .sort((a, b) => new Date(b.cerrada_en) - new Date(a.cerrada_en))
          .map(o => {
            const fecha = this.formatearFecha(o.cerrada_en);
            const serviciosOrden = this.state.servicios.filter(s => s.num_orden === o.num_orden);
            const tiempoTotal = serviciosOrden.reduce((acc, s) => acc + (s.tiempo_real_min || 0), 0);
            const completados = serviciosOrden.filter(s => s.estado === 'completado').length;
            const cancelados = serviciosOrden.filter(s => s.estado === 'cancelado').length;
            const totalActivos = serviciosOrden.length - cancelados;

            const fraccionHtml = totalActivos > 0
              ? `<span class="progreso-fraccion">
                   <span class="prog-num prog-num-ok">${completados}</span><span class="prog-sep">/</span><span class="prog-num prog-num-ok">${totalActivos}</span>
                   <span class="prog-label">servicios</span>
                 </span>`
              : '';

            return `
              <div class="kpi-item" data-orden="${o.num_orden}">
                <div class="kpi-item-info">
                  <div class="kpi-item-titulo">${Utils.escapeHtml(o.placa)} · ${o.num_orden} ${fraccionHtml}</div>
                  <div class="kpi-item-meta">Completada ${fecha} · ${tiempoTotal} min total${cancelados > 0 ? ` · ${cancelados} cancelado${cancelados !== 1 ? 's' : ''}` : ''}</div>
                </div>
              </div>
            `;
          }).join('');
      }
    } else if (tipo === 'pendiente-entrega') {
      // Lista las órdenes completadas que aún no han sido recogidas por motorista.
      // Se ordena por la más antigua primero (las que llevan más esperando arriba).
      const ords = this.state.ordenes.filter(
        o => o.estado === 'completada' && !o.entregada_en
      );
      if (ords.length === 0) {
        html = '<div class="empty-state"><p>Sin unidades pendientes de entrega. ✓</p></div>';
      } else {
        html = ords
          .sort((a, b) => new Date(a.cerrada_en || 0) - new Date(b.cerrada_en || 0))
          .map(o => {
            const fecha = this.formatearFecha(o.cerrada_en);
            // Calcular cuántas horas lleva esperando
            const horasEspera = o.cerrada_en
              ? Math.max(0, Math.round((Date.now() - new Date(o.cerrada_en)) / 3600000))
              : 0;
            const espera = horasEspera < 1 ? 'Recién terminada'
                         : horasEspera === 1 ? 'Esperando 1 hora'
                         : horasEspera < 24 ? `Esperando ${horasEspera} horas`
                         : `Esperando ${Math.floor(horasEspera / 24)} día${Math.floor(horasEspera / 24) !== 1 ? 's' : ''}`;
            return `
              <div class="kpi-item" data-orden="${o.num_orden}">
                <div class="kpi-item-info">
                  <div class="kpi-item-titulo">${Utils.escapeHtml(o.placa)} · ${o.num_orden}</div>
                  <div class="kpi-item-meta">Lista ${fecha} · ${espera}</div>
                </div>
              </div>
            `;
          }).join('');
      }
    }

    document.getElementById('kpi-modal-list').innerHTML = html;

    // Bindear clicks
    document.querySelectorAll('#kpi-modal-list .kpi-item').forEach(item => {
      item.addEventListener('click', () => {
        const num = item.dataset.orden;
        if (num) {
          window.location.href = `orden-detalle.html?orden=${encodeURIComponent(num)}`;
        }
      });
    });

    document.getElementById('kpi-modal').hidden = false;
  },

  cerrarKpiModal() {
    document.getElementById('kpi-modal').hidden = true;
  },

  // ==================== 2. ALERTAS ====================
  renderAlertas() {
    // Servicios completados en el rango con sospechoso=true
    const sospechosos = this.state.servicios.filter(
      s => s.estado === 'completado' && s.sospechoso === true && this.enRango(s.hora_fin)
    );

    const card = document.getElementById('alerta-card');
    if (sospechosos.length === 0) {
      card.hidden = true;
      return;
    }

    card.hidden = false;
    document.getElementById('alerta-count').textContent =
      `${sospechosos.length} servicio${sospechosos.length !== 1 ? 's' : ''} con tiempo fuera de rango`;

    const cont = document.getElementById('alerta-lista');
    cont.innerHTML = sospechosos.map(s => {
      const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
      const mediana = cat?.tiempo_promedio_min || 0;
      const ratio = mediana > 0 ? (s.tiempo_real_min / mediana).toFixed(1) : '?';
      const tipo = mediana > 0 && s.tiempo_real_min > mediana * 3
        ? `${ratio}× más lento`
        : mediana > 0 && s.tiempo_real_min < mediana * 0.1
          ? `${ratio}× sospechosamente rápido`
          : 'fuera de rango';
      const orden = this.state.ordenes.find(o => o.num_orden === s.num_orden);
      return `
        <div class="alerta-item" data-orden="${s.num_orden}">
          <div class="alerta-item-info">
            <div class="alerta-item-titulo">${Utils.escapeHtml(this.nombreServicio(s.servicio_id))}</div>
            <div class="alerta-item-meta">
              ${orden ? Utils.escapeHtml(orden.placa) : '—'} · ${s.num_orden} ·
              ${Utils.escapeHtml(this.nombreUsuario(s.tecnico_id))} ·
              ${s.tiempo_real_min} min (mediana ${mediana} min)
            </div>
          </div>
          <div class="alerta-item-tiempo">${tipo}</div>
        </div>
      `;
    }).join('');

    cont.querySelectorAll('.alerta-item').forEach(item => {
      item.addEventListener('click', () => {
        const num = item.dataset.orden;
        window.location.href = `orden-detalle.html?orden=${encodeURIComponent(num)}`;
      });
    });
  },

  // ==================== 3. TÉCNICOS EN VIVO ====================
  renderTecnicos() {
    // Detener cronómetros viejos (servicios en curso + pausas)
    Object.values(this.state.cronometros).forEach(i => clearInterval(i));
    Object.values(this.state.cronometrosPausa).forEach(i => clearInterval(i));
    this.state.cronometros = {};
    this.state.cronometrosPausa = {};

    const tecnicos = this.state.usuarios.filter(u => u.rol === 'tecnico');
    const cont = document.getElementById('tecnicos-list');

    if (tecnicos.length === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Sin técnicos activos.</p></div>';
      document.getElementById('tecnicos-stats').textContent = '0';
      return;
    }

    let trabajando = 0, pausado = 0, libre = 0;

    const html = tecnicos.map(t => {
      // TODOS sus servicios EN_PROGRESO (no solo el primero) — fix bug multi-actividad
      const serviciosActivos = this.state.servicios.filter(
        s => s.tecnico_id === t.id && s.estado === 'en_progreso'
      );
      const serviciosPausados = this.state.servicios.filter(
        s => s.tecnico_id === t.id && s.estado === 'pausado'
      );

      let estado, statusClass, cardClass, actividadHtml, tiempoHtml;

      if (serviciosActivos.length > 0) {
        trabajando++;
        estado = 'Trabajando';
        statusClass = 'status-trabajando';
        cardClass = 'tec-trabajando';

        // Mostrar TODOS los servicios activos con su cronómetro inline
        actividadHtml = serviciosActivos.map(sa => {
          const orden = this.state.ordenes.find(o => o.num_orden === sa.num_orden);
          const placa = orden ? orden.placa : '—';
          return `<div class="tecnico-actividad-linea">
                    <span class="placa-mini">${Utils.escapeHtml(placa)}</span>
                    <span class="actividad-nombre">${Utils.escapeHtml(this.nombreServicio(sa.servicio_id))}</span>
                    <span class="actividad-cronos" id="cron-${t.id}-${sa.id}">00:00:00</span>
                    <button type="button" class="btn-pausa-remota" data-action="pausar-remoto" data-sid="${sa.id}" data-tid="${t.id}" title="Pausar (técnico ausente)">⏸</button>
                  </div>`;
        }).join('');

        // Si hay pausados también, agregarlos atenuados con cronómetro de pausa
        if (serviciosPausados.length > 0) {
          actividadHtml += serviciosPausados.map(sp => {
            const orden = this.state.ordenes.find(o => o.num_orden === sp.num_orden);
            const placa = orden ? orden.placa : '—';
            const pausa = this.pausaAbierta(sp.id);
            const motivos = {
              repuesto: 'repuesto', cambio_unidad: 'cambio unidad',
              personal: 'personal', reasignacion_jefe: 'reasignación', ausente: 'ausente'
            };
            const motivo = pausa ? (motivos[pausa.motivo] || pausa.motivo) : '';
            const esAusente = pausa?.motivo === 'ausente';
            return `<div class="tecnico-actividad-linea atenuado">
                      <span class="placa-mini">${Utils.escapeHtml(placa)}</span>
                      <span class="actividad-nombre">${Utils.escapeHtml(this.nombreServicio(sp.servicio_id))}</span>
                      ${motivo ? `<span class="motivo-tag ${esAusente ? 'motivo-ausente' : ''}">${motivo}</span>` : ''}
                      <span class="actividad-cronos pausa-cronos-inline" id="pausa-cron-inline-${sp.id}" data-inicio="${pausa?.hora_pausa || ''}">--:--:--</span>
                      ${esAusente ? `<button type="button" class="btn-reanudar-remoto" data-action="reanudar-remoto" data-sid="${sp.id}" title="Reanudar">▶</button>` : ''}${pausa ? `<button type="button" class="btn-cerrar-dia" data-action="cerrar-dia" data-sid="${sp.id}" data-tid="${t.id}" title="Cerrar día">⏹</button>` : ''}
                    </div>`;
          }).join('');
        }

        // No mostrar tiempo total en columna derecha (cada servicio tiene el suyo)
        tiempoHtml = '';
      } else if (serviciosPausados.length > 0) {
        pausado++;
        estado = 'Pausado';
        statusClass = 'status-pausado';
        cardClass = 'tec-pausado';

        actividadHtml = serviciosPausados.map(sp => {
          const orden = this.state.ordenes.find(o => o.num_orden === sp.num_orden);
          const placa = orden ? orden.placa : '—';
          const pausa = this.pausaAbierta(sp.id);
          const motivos = {
            repuesto: 'repuesto', cambio_unidad: 'cambio unidad',
            personal: 'personal', reasignacion_jefe: 'reasignación', ausente: 'ausente'
          };
          const motivo = pausa ? (motivos[pausa.motivo] || pausa.motivo) : '';
          const esAusente = pausa?.motivo === 'ausente';
          return `<div class="tecnico-actividad-linea">
                    <span class="placa-mini">${Utils.escapeHtml(placa)}</span>
                    <span class="actividad-nombre">${Utils.escapeHtml(this.nombreServicio(sp.servicio_id))}</span>
                    ${motivo ? `<span class="motivo-tag ${esAusente ? 'motivo-ausente' : ''}">${motivo}</span>` : ''}
                    <span class="actividad-cronos pausa-cronos-inline" id="pausa-cron-inline-${sp.id}" data-inicio="${pausa?.hora_pausa || ''}">--:--:--</span>
                    ${esAusente ? `<button type="button" class="btn-reanudar-remoto" data-action="reanudar-remoto" data-sid="${sp.id}" title="Reanudar">▶</button>` : ''}${pausa ? `<button type="button" class="btn-cerrar-dia" data-action="cerrar-dia" data-sid="${sp.id}" data-tid="${t.id}" title="Cerrar día">⏹</button>` : ''}
                  </div>`;
        }).join('');

        tiempoHtml = '';
      } else {
        libre++;
        estado = 'Libre';
        statusClass = 'status-libre';
        cardClass = 'tec-libre';
        actividadHtml = '<div class="tecnico-actividad-linea">Sin trabajo asignado</div>';
        tiempoHtml = '';
      }

      return `
        <div class="tecnico-card ${cardClass}">
          <div class="tecnico-status ${statusClass}"></div>
          <div class="tecnico-info">
            <div class="tecnico-nombre">${Utils.escapeHtml(t.nombre)}</div>
            <div class="tecnico-actividad">${actividadHtml}</div>
          </div>
          ${tiempoHtml}
        </div>
      `;
    }).join('');

    cont.innerHTML = html;

    document.getElementById('tecnicos-stats').textContent =
      `${trabajando} trabajando · ${pausado} pausados · ${libre} libres`;

    // Mostrar/ocultar botón maestro "Cerrar día de todos" según haya pausas abiertas
    const btnCerrarTodos = document.getElementById('btn-cerrar-dia-todos');
    if (btnCerrarTodos) {
      const pausasAbiertasCount = (this.state.pausas || []).filter(p => !p.hora_reanudacion).length;
      if (pausasAbiertasCount > 0) {
        btnCerrarTodos.hidden = false;
        btnCerrarTodos.textContent = `🔚 Cerrar día (${pausasAbiertasCount})`;
      } else {
        btnCerrarTodos.hidden = true;
      }
    }

    // Event delegation para botones de pausa/reanuda remota (un solo listener que sobrevive re-renders)
    if (!cont.dataset.boundRemota) {
      cont.dataset.boundRemota = 'true';
      cont.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'pausar-remoto') {
          const sid = parseInt(btn.dataset.sid, 10);
          const tid = btn.dataset.tid;
          this.pausarServicioRemoto(sid, tid);
        } else if (action === 'reanudar-remoto') {
          const sid = parseInt(btn.dataset.sid, 10);
          this.reanudarServicioRemoto(sid);
        } else if (action === 'cerrar-dia') {
          const sid = parseInt(btn.dataset.sid, 10);
          const tid = btn.dataset.tid;
          this.cerrarDiaServicioRemoto(sid, tid);
        }
      });
    }

    // Iniciar cronómetros para TODOS los servicios activos y pausados
    tecnicos.forEach(t => {
      // Servicios EN_PROGRESO: cronómetro de tiempo trabajado
      const serviciosActivos = this.state.servicios.filter(
        s => s.tecnico_id === t.id && s.estado === 'en_progreso'
      );
      serviciosActivos.forEach(sa => {
        if (sa.hora_inicio) {
          this.iniciarCronometroTecnico(t.id, sa);
        }
      });

      // Servicios PAUSADOS: cronómetro de tiempo pausado
      const serviciosPausados = this.state.servicios.filter(
        s => s.tecnico_id === t.id && s.estado === 'pausado'
      );
      serviciosPausados.forEach(sp => {
        const pausa = this.pausaAbierta(sp.id);
        if (pausa) {
          this.iniciarCronometroPausaInline(sp.id, pausa.hora_pausa);
        }
      });
    });
  },

  iniciarCronometroPausaInline(servicioId, horaPausaIso) {
    const elementId = 'pausa-cron-inline-' + servicioId;
    const inicioMs = new Date(horaPausaIso).getTime();
    const UMBRAL_ALERTA_MS = 2 * 60 * 60 * 1000;  // 2 horas

    const update = () => {
      const ahora = Date.now();
      const transcurridoMs = ahora - inicioMs;
      if (transcurridoMs < 0) {
        const el = document.getElementById(elementId);
        if (el) el.textContent = '--:--:--';
        return;
      }
      const totalSeg = Math.floor(transcurridoMs / 1000);
      const h = Math.floor(totalSeg / 3600);
      const m = Math.floor((totalSeg % 3600) / 60);
      const s = totalSeg % 60;
      const fmt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      const el = document.getElementById(elementId);
      if (el) {
        el.textContent = fmt;
        if (transcurridoMs > UMBRAL_ALERTA_MS) {
          el.classList.add('pausa-cronos-alerta');
        } else {
          el.classList.remove('pausa-cronos-alerta');
        }
      }
    };

    update();
    const key = 'pausa_inline_' + servicioId;
    this.state.cronometrosPausa[key] = setInterval(update, 1000);
  },

  iniciarCronometroTecnico(tecnicoId, servicio) {
    const elementId = 'cron-' + tecnicoId + '-' + servicio.id;
    const update = () => {
      const inicioMs = new Date(servicio.hora_inicio).getTime();
      const ahora = Date.now();
      const segPausados = this.segundosPausados(servicio.id);
      const transcurridoMs = ahora - inicioMs - (segPausados * 1000);
      const totalSeg = Math.max(0, Math.floor(transcurridoMs / 1000));
      const h = Math.floor(totalSeg / 3600);
      const m = Math.floor((totalSeg % 3600) / 60);
      const s = totalSeg % 60;
      const fmt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      const el = document.getElementById(elementId);
      if (el) el.textContent = fmt;
    };

    update();
    const key = tecnicoId + '_' + servicio.id;
    this.state.cronometros[key] = setInterval(update, 1000);
  },

  // ==================== 4. PRODUCTIVIDAD ====================
  renderProductividad() {
    const tecnicos = this.state.usuarios.filter(u => u.rol === 'tecnico');
    const cont = document.getElementById('productividad-list');

    // ========================================================================
    // FIX: Acotar TODOS los cálculos a la ventana del rango.
    // Si un servicio se inició ayer y se completó hoy, solo cuenta lo trabajado
    // dentro del rango (ej: para "hoy", desde hoy 00:00 hasta ahora).
    // El tiempo en pausa (incluida la noche) NUNCA suma como tiempo trabajado.
    // ========================================================================
    const rangoIni = new Date(this.state.fechaDesde);
    const rangoFin = new Date(this.state.fechaHasta);
    const ahora = new Date();

    // Helper: intersección de [aIni, aFin] con [bIni, bFin] devuelta en minutos.
    // Devuelve 0 si no hay intersección.
    const interseccionMin = (aIni, aFin, bIni, bFin) => {
      if (!aIni || !aFin) return 0;
      const ini = aIni > bIni ? aIni : bIni;
      const fin = aFin < bFin ? aFin : bFin;
      if (fin <= ini) return 0;
      return Math.round((fin - ini) / 60000);
    };

    // Helper: suma minutos de pausas CERRADAS de un servicio que intersectan
    // la ventana [desde, hasta]. Pausas abiertas no se cuentan (no tienen fin).
    const pausasServicioInter = (servicioId, desde, hasta) => {
      if (!Array.isArray(this.state.pausas) || this.state.pausas.length === 0) return 0;
      let total = 0;
      this.state.pausas.forEach(p => {
        if (p.servicio_orden_id !== servicioId) return;
        if (!p.hora_pausa || !p.hora_reanudacion) return;
        total += interseccionMin(new Date(p.hora_pausa), new Date(p.hora_reanudacion), desde, hasta);
      });
      return total;
    };

    // ========================================================================
    // ALGORITMO DE INTERVALOS ACTIVOS
    //
    // Concepto: cada servicio se descompone en una serie de "intervalos activos"
    // (lapsos donde el técnico realmente estaba trabajando en ese servicio).
    //
    // Ejemplo: si un servicio empezó 08:00, se pausó 09:00-09:30 y terminó 11:00,
    //   intervalos activos del servicio = [(08:00, 09:00), (09:30, 11:00)]
    //
    // T. SERVICIOS (por servicio) = suma de duraciones de SUS intervalos activos
    //   acotados al rango del filtro. Suma simple por técnico
    //   (puede ser > rango si hay servicios solapados).
    //
    // T. ACTIVO (por técnico) = duración de la UNIÓN de intervalos activos
    //   de TODOS sus servicios, acotados al rango. La unión resuelve solapamientos:
    //   si trabajó dos servicios al mismo tiempo, ese minuto cuenta 1 sola vez.
    //
    // APROVECH. = T. SERVICIOS / T. ACTIVO * 100
    //   100% = todo el tiempo activo lo dedicó a UN servicio a la vez
    //   200% = típicamente trabajó 2 servicios simultáneos todo el tiempo
    // ========================================================================

    // Helper: construye la lista de intervalos activos de un servicio.
    // Toma [hora_inicio, hora_fin_efectivo] y le "saca" los pedazos donde estuvo
    // pausado (según historial_pausas). Devuelve [{ini, fin}] como objetos Date.
    const intervalosActivosDeServicio = (s) => {
      if (!s.hora_inicio) return [];
      const ini = new Date(s.hora_inicio);

      // Determinar el "fin efectivo" del servicio
      let fin;
      if (s.estado === 'completado') {
        if (!s.hora_fin) return [];
        fin = new Date(s.hora_fin);
      } else if (s.estado === 'pausado') {
        const pausa = this.pausaAbierta(s.id);
        if (pausa) {
          // Está pausado ahora mismo: el último período activo terminó al pausar
          fin = new Date(pausa.hora_pausa);
        } else {
          // Pausa cerrada pero estado todavía 'pausado' (ej: cierre de día):
          // el último período activo terminó cuando empezó la última pausa
          const ult = this.ultimaPausaDelServicio(s.id);
          fin = ult ? new Date(ult.hora_pausa) : ini;
        }
      } else if (s.estado === 'en_progreso') {
        fin = ahora;
      } else {
        return [];
      }

      if (fin <= ini) return [];

      // Traer pausas CERRADAS de este servicio dentro de [ini, fin], ordenadas
      const pausasCerradas = (this.state.pausas || [])
        .filter(p => p.servicio_orden_id === s.id && p.hora_pausa && p.hora_reanudacion)
        .map(p => ({ ini: new Date(p.hora_pausa), fin: new Date(p.hora_reanudacion) }))
        .filter(p => p.ini < fin && p.fin > ini)
        .sort((a, b) => a.ini - b.ini);

      // Construir intervalos activos: ini -> primera pausa, después entre pausas,
      // y desde la última reanudación al fin.
      const intervalos = [];
      let cursor = ini;
      pausasCerradas.forEach(p => {
        const pIni = p.ini < cursor ? cursor : p.ini;
        const pFin = p.fin > fin ? fin : p.fin;
        if (pIni > cursor) intervalos.push({ ini: cursor, fin: pIni });
        if (pFin > cursor) cursor = pFin;
      });
      if (cursor < fin) intervalos.push({ ini: cursor, fin: fin });

      return intervalos;
    };

    // Helper: acota un intervalo al rango del filtro Y al horario laboral
    // de cada día. Devuelve un ARRAY de sub-intervalos resultantes (puede ser
    // vacío si no intersecta nada útil).
    //
    // Aplica DOS reglas para evitar inflar tiempos por olvidos de pausar:
    //   1) Recorta al rango del filtro [rangoIni, rangoFin]
    //   2) Recorta a la franja [horaInicio:00, horaFin:00] de cada día calendario
    //      que toca. Esto descarta automáticamente la noche y madrugada.
    const HORA_INI = this.CONFIG_HORARIO_LABORAL.horaInicio;
    const HORA_FIN = this.CONFIG_HORARIO_LABORAL.horaFin;

    const acotarAlRango = (intv) => {
      // Paso 1: acotar al rango del filtro
      let ini = intv.ini > rangoIni ? new Date(intv.ini) : new Date(rangoIni);
      let fin = intv.fin < rangoFin ? new Date(intv.fin) : new Date(rangoFin);
      if (fin <= ini) return [];

      // Paso 2: recorrer cada día calendario que cruza el intervalo y
      // generar un sub-intervalo limitado al horario laboral de ese día.
      const resultado = [];
      let cursor = new Date(ini);
      while (cursor < fin) {
        // Calcular [diaIni, diaFin] del horario laboral del día actual
        const diaLab = new Date(cursor);
        diaLab.setHours(HORA_INI, 0, 0, 0);
        const diaFinLab = new Date(cursor);
        diaFinLab.setHours(HORA_FIN, 0, 0, 0);

        // Acotar el sub-intervalo a [diaLab, diaFinLab] ∩ [cursor, fin]
        const subIni = cursor > diaLab ? cursor : diaLab;
        const finDelDia = new Date(cursor);
        finDelDia.setHours(23, 59, 59, 999);
        const techoCursor = fin < finDelDia ? fin : finDelDia;
        const subFin = techoCursor < diaFinLab ? techoCursor : diaFinLab;
        if (subFin > subIni) {
          resultado.push({ ini: new Date(subIni), fin: new Date(subFin) });
        }

        // Avanzar al día siguiente, 00:00
        const siguiente = new Date(cursor);
        siguiente.setDate(siguiente.getDate() + 1);
        siguiente.setHours(0, 0, 0, 0);
        cursor = siguiente;
      }
      return resultado;
    };

    // Helper: aplica el tope máximo a un intervalo. Si dura más que
    // INTERVALO_MAX_MIN, se trunca a ese máximo (caso típico: técnico no
    // pausó y dejó el cronómetro corriendo). Solo se usa para intervalos
    // ANTES de acotar al rango/horario; protege contra absurdos como
    // "16 horas continuas sin pausa".
    const TOPE_INTERVALO_MS = this.CONFIG_HORARIO_LABORAL.INTERVALO_MAX_MIN * 60000;
    const aplicarTope = (intv) => {
      if (intv.fin - intv.ini > TOPE_INTERVALO_MS) {
        return { ini: intv.ini, fin: new Date(intv.ini.getTime() + TOPE_INTERVALO_MS) };
      }
      return intv;
    };

    // Helper: dado un array de intervalos, los une (resuelve solapamientos) y
    // devuelve un nuevo array con los intervalos disjuntos en orden.
    const unirIntervalos = (lista) => {
      if (lista.length === 0) return [];
      const ordenados = [...lista].sort((a, b) => a.ini - b.ini);
      const resultado = [ordenados[0]];
      for (let i = 1; i < ordenados.length; i++) {
        const last = resultado[resultado.length - 1];
        const curr = ordenados[i];
        if (curr.ini <= last.fin) {
          // Se solapan: extender el último si el actual va más allá
          if (curr.fin > last.fin) last.fin = curr.fin;
        } else {
          resultado.push(curr);
        }
      }
      return resultado;
    };

    // Helper: suma minutos de una lista de intervalos
    const sumarMinutos = (lista) =>
      lista.reduce((acc, x) => acc + Math.round((x.fin - x.ini) / 60000), 0);

    // ========================================================================
    // FASE 1: Para cada técnico, calcular intervalos activos del rango y
    //         las dos métricas (T. SERVICIOS y T. ACTIVO).
    // ========================================================================
    const stats = {};
    tecnicos.forEach(t => {
      stats[t.id] = {
        id: t.id,
        nombre: t.nombre,
        codigo: t.codigo,
        servicios: 0,
        tiempoReal: 0,        // T. SERVICIOS = suma simple (con solapamientos)
        tiempoEsperado: 0,
        tiempoActivo: 0,      // T. ACTIVO = duración de la unión
        listaServicios: [],
      };
    });

    // Recorrer todos los servicios con técnico asignado y construir intervalos
    const intervalosPorTecnico = {}; // { tecId: [intervalos acotados al rango] }

    this.state.servicios.forEach(s => {
      if (!s.tecnico_id || !stats[s.tecnico_id]) return;
      if (!s.hora_inicio) return;

      // 1. Intervalos activos del servicio (sin acotar)
      const intervalosBrutos = intervalosActivosDeServicio(s);
      if (intervalosBrutos.length === 0) return;

      // 2. Aplicar TOPE: ningún intervalo continuo puede superar el máximo
      //    (defensa contra técnicos que olvidan pausar)
      const intervalosTopeados = intervalosBrutos.map(aplicarTope);

      // 3. Acotar al rango del filtro + horario laboral. Cada intervalo puede
      //    expandirse a varios sub-intervalos (uno por día laboral cubierto).
      const intervalosRango = [];
      intervalosTopeados.forEach(iv => {
        const subs = acotarAlRango(iv);
        intervalosRango.push(...subs);
      });
      if (intervalosRango.length === 0) return;

      // 4. Suma de minutos de este servicio en el rango (para T. SERVICIOS)
      const minutosServicio = sumarMinutos(intervalosRango);

      // 5. Acumular al técnico
      const st = stats[s.tecnico_id];
      st.servicios += 1;
      st.tiempoReal += minutosServicio;
      st.listaServicios.push(s);

      const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
      const mediana = cat?.tiempo_promedio_min || 0;
      st.tiempoEsperado += mediana;

      // Agregar intervalos a la lista global del técnico (para unir luego)
      if (!intervalosPorTecnico[s.tecnico_id]) intervalosPorTecnico[s.tecnico_id] = [];
      intervalosPorTecnico[s.tecnico_id].push(...intervalosRango);
    });

    // ========================================================================
    // FASE 2: Calcular T. ACTIVO uniendo intervalos solapados
    // ========================================================================
    Object.keys(intervalosPorTecnico).forEach(tecId => {
      const unidos = unirIntervalos(intervalosPorTecnico[tecId]);
      stats[tecId].tiempoActivo = sumarMinutos(unidos);
    });

    // ========================================================================
    // FASE 3: Aprovechamiento = T. ACTIVO / Jornada pagada del rango
    //
    // La jornada pagada se calcula como: 8h × cantidad de días hábiles
    // (lunes a sábado, sin domingos) que el rango cubre.
    //
    // Ejemplos:
    //   - Filtro "Hoy" (lunes) → 480 min de jornada
    //   - Filtro "Día 30/04" → 480 min
    //   - Filtro "Esta semana" (lun-sab) → 6 × 480 = 2880 min
    //   - Filtro "Este mes" → ~26 días × 480 = 12480 min
    //
    // Esto da una métrica de "cuánto del tiempo pagado fue productivo".
    // ========================================================================
    const JORNADA_MIN = this.CONFIG_HORARIO_LABORAL.JORNADA_PAGADA_MIN;

    // Contar días hábiles entre rangoIni y rangoFin (lun-sab, sin domingos).
    // Si querés excluir también sábados, cambiá la condición.
    const contarDiasHabiles = () => {
      let dias = 0;
      const cursor = new Date(rangoIni);
      cursor.setHours(0, 0, 0, 0);
      const fin = new Date(rangoFin);
      while (cursor <= fin) {
        const diaSemana = cursor.getDay(); // 0=domingo
        if (diaSemana !== 0) dias += 1;
        cursor.setDate(cursor.getDate() + 1);
      }
      return Math.max(1, dias); // mínimo 1 para evitar división por cero
    };

    const diasHabilesRango = contarDiasHabiles();
    const jornadaPagadaMin = JORNADA_MIN * diasHabilesRango;

    Object.values(stats).forEach(st => {
      if (st.servicios > 0 && jornadaPagadaMin > 0) {
        // Aprovechamiento = qué porcentaje de su jornada pagada estuvo activo
        st.aprovechamiento = Math.round((st.tiempoActivo / jornadaPagadaMin) * 100);
      } else {
        st.aprovechamiento = null;
      }
    });

    // Si nadie trabajó en el rango, mensaje vacío
    const algunoConServicios = Object.values(stats).some(s => s.servicios > 0);
    if (!algunoConServicios) {
      cont.innerHTML = '<div class="empty-state"><p>Sin servicios en este rango.</p></div>';
      return;
    }

    // Filtrar técnicos con al menos 1 servicio
    const filas = Object.values(stats)
      .filter(x => x.servicios > 0)
      .sort((a, b) => b.servicios - a.servicios);

    if (filas.length === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Sin servicios por técnicos en este rango.</p></div>';
      return;
    }

    let html = `
      <div class="prod-row prod-header">
        <div>Técnico</div>
        <div>Servicios</div>
        <div>T. Activo</div>
        <div>T. Servicios</div>
        <div>Esperado</div>
        <div>Eficiencia</div>
        <div>Aprovech.</div>
      </div>
    `;

    html += filas.map(x => {
      // Eficiencia (sin cambio de lógica)
      let eficiencia = '—';
      let efClass = 'normal';
      if (x.tiempoEsperado > 0) {
        const ratio = x.tiempoReal / x.tiempoEsperado;
        const pct = Math.round(ratio * 100);

        if (ratio < 0.85) {
          efClass = 'eficiente';
          eficiencia = `${pct}% ⚡`;
        } else if (ratio <= 1.2) {
          efClass = 'normal';
          eficiencia = `${pct}%`;
        } else if (ratio <= 1.8) {
          efClass = 'lento';
          eficiencia = `${pct}%`;
        } else {
          efClass = 'muy-lento';
          eficiencia = `${pct}% ⚠️`;
        }
      }

      // Aprovechamiento (NUEVO con badge de color)
      let aprovTxt = '—';
      let aprovClass = 'normal';
      if (x.aprovechamiento !== null) {
        aprovTxt = `${x.aprovechamiento}%`;
        // Escala basada en el % de jornada pagada que estuvo realmente activo:
        //   ≥ 80% → excelente (verde)
        //   60-79% → bueno (amarillo / medio)
        //   < 60% → bajo (rojo)
        if (x.aprovechamiento >= 80) aprovClass = 'aprov-bueno';
        else if (x.aprovechamiento >= 60) aprovClass = 'aprov-medio';
        else aprovClass = 'aprov-bajo';
      }

      const tiempoTxt = this.formatMin(x.tiempoReal);
      const espTxt = this.formatMin(x.tiempoEsperado);
      const activoTxt = (!x.tiempoActivo || x.tiempoActivo === 0) ? '—' : this.formatMin(x.tiempoActivo);

      // Detalle expandible — ahora muestra completados, pausados y en progreso
      const detalleServicios = x.listaServicios
        .slice()
        .sort((a, b) => {
          // Ordenar por fecha más reciente primero (usar hora_fin si está, sino hora_inicio)
          const ta = a.hora_fin ? new Date(a.hora_fin) : (a.hora_inicio ? new Date(a.hora_inicio) : 0);
          const tb = b.hora_fin ? new Date(b.hora_fin) : (b.hora_inicio ? new Date(b.hora_inicio) : 0);
          return tb - ta;
        })
        .map(s => {
          const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
          const orden = this.state.ordenes.find(o => o.num_orden === s.num_orden);
          const placa = orden?.placa || '—';
          const mediana = cat?.tiempo_promedio_min || 0;

          // Tiempo del servicio EN EL RANGO (consistente con T. SERVICIOS de
          // la fila resumen). Usa el mismo helper + tope + horario laboral.
          const intervalosBrutos = intervalosActivosDeServicio(s);
          const intervalosTopeados = intervalosBrutos.map(aplicarTope);
          const intervalosRango = [];
          intervalosTopeados.forEach(iv => {
            const subs = acotarAlRango(iv);
            intervalosRango.push(...subs);
          });
          const tiempoReal = sumarMinutos(intervalosRango);

          let etiquetaEstado = '';
          if (s.estado === 'pausado') etiquetaEstado = ' (pausado)';
          else if (s.estado === 'en_progreso') etiquetaEstado = ' (en progreso)';

          let detClass = 'detalle-normal';
          let detIcon = '';
          if (s.estado === 'completado' && mediana > 0) {
            const ratio = tiempoReal / mediana;
            if (ratio < 0.85) { detClass = 'detalle-eficiente'; detIcon = '⚡'; }
            else if (ratio > 1.8) { detClass = 'detalle-lento'; detIcon = '⚠️'; }
            else if (ratio > 1.2) { detClass = 'detalle-medio'; }
          }

          const fechaFin = s.hora_fin ? this.formatearHora(s.hora_fin) :
                           s.hora_inicio ? this.formatearHora(s.hora_inicio) : '—';

          return `
            <div class="prod-detalle-item ${detClass}" data-orden="${s.num_orden}">
              <div class="prod-detalle-info">
                <div class="prod-detalle-titulo">${detIcon} ${Utils.escapeHtml(cat?.nombre || 'Servicio')}${etiquetaEstado}</div>
                <div class="prod-detalle-meta">${Utils.escapeHtml(placa)} · ${s.num_orden} · ${fechaFin}</div>
              </div>
              <div class="prod-detalle-tiempo">
                <div>${tiempoReal} min</div>
                ${mediana > 0 ? `<div class="prod-detalle-mediana">esperado: ${mediana} min</div>` : ''}
              </div>
            </div>
          `;
        }).join('');

      return `
        <div class="prod-row prod-row-clickable" data-tecnico="${x.id}">
          <div class="prod-tecnico">
            <span class="prod-toggle">▶</span>
            ${Utils.escapeHtml(x.nombre)}
          </div>
          <div class="prod-numero">${x.servicios}</div>
          <div class="prod-numero">${activoTxt}</div>
          <div class="prod-numero">${tiempoTxt}</div>
          <div class="prod-numero">${espTxt}</div>
          <div class="prod-eficiencia ${efClass}">${eficiencia}</div>
          <div class="prod-aprov ${aprovClass}">${aprovTxt}</div>
        </div>
        <div class="prod-detalle" id="prod-detalle-${x.id}" hidden>
          ${detalleServicios}
        </div>
      `;
    }).join('');

    cont.innerHTML = html;

    // Restaurar estado de expandidos (después de re-render por polling)
    this.state.tecnicosExpandidos.forEach(tid => {
      const detalle = document.getElementById('prod-detalle-' + tid);
      const row = cont.querySelector(`[data-tecnico="${tid}"]`);
      if (detalle && row) {
        detalle.hidden = false;
        const toggle = row.querySelector('.prod-toggle');
        if (toggle) toggle.textContent = '▼';
        row.classList.add('prod-row-expanded');
      }
    });

    // EVENT DELEGATION: un solo listener en el contenedor que sobrevive re-renders
    // Solo bindear si aún no se hizo (la primera vez)
    if (!cont.dataset.boundDelegate) {
      cont.dataset.boundDelegate = 'true';
      cont.addEventListener('click', (e) => {
        // Click en una fila clickeable
        const row = e.target.closest('.prod-row-clickable');
        if (row) {
          // Si el click vino de un detalle interior, manejarlo aparte
          const detalleItem = e.target.closest('.prod-detalle-item');
          if (detalleItem) {
            // Click en un servicio individual del detalle
            const num = detalleItem.dataset.orden;
            if (num) {
              window.location.href = `orden-detalle.html?orden=${encodeURIComponent(num)}`;
            }
            return;
          }

          // Click en el row de técnico → toggle del detalle
          const tid = row.dataset.tecnico;
          const detalle = document.getElementById('prod-detalle-' + tid);
          const toggle = row.querySelector('.prod-toggle');
          if (!detalle) return;

          const estaOculto = detalle.hidden;
          if (estaOculto) {
            detalle.hidden = false;
            if (toggle) toggle.textContent = '▼';
            row.classList.add('prod-row-expanded');
            this.state.tecnicosExpandidos.add(tid);
          } else {
            detalle.hidden = true;
            if (toggle) toggle.textContent = '▶';
            row.classList.remove('prod-row-expanded');
            this.state.tecnicosExpandidos.delete(tid);
          }
          return;
        }

        // Click directo en un servicio del detalle (cuando no se enmarcó en row)
        const detalleItem = e.target.closest('.prod-detalle-item');
        if (detalleItem) {
          const num = detalleItem.dataset.orden;
          if (num) {
            window.location.href = `orden-detalle.html?orden=${encodeURIComponent(num)}`;
          }
        }
      });
    }
  },

  // ==================== 5. CANCELACIONES ====================
  renderCancelaciones() {
    const cont = document.getElementById('cancelaciones-list');
    const lista = this.state.cancelaciones;

    document.getElementById('canc-count').textContent = lista.length;

    if (lista.length === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Sin cancelaciones en este rango.</p></div>';
      return;
    }

    cont.innerHTML = lista.map(c => {
      const orden = this.state.ordenes.find(o => o.num_orden === c.num_orden);
      const placa = orden?.placa || '—';
      const fecha = this.formatearFecha(c.cancelada_en);
      const quien = this.nombreUsuario(c.cancelada_por);

      return `
        <div class="canc-row" data-orden="${c.num_orden}">
          <div class="canc-icon">✗</div>
          <div class="canc-info">
            <div class="canc-titulo">${Utils.escapeHtml(placa)} · ${c.num_orden}</div>
            <div class="canc-motivo">"${Utils.escapeHtml(c.motivo)}"</div>
            <div class="canc-meta">${fecha} · Por ${Utils.escapeHtml(quien)}</div>
          </div>
        </div>
      `;
    }).join('');

    cont.querySelectorAll('.canc-row').forEach(row => {
      row.addEventListener('click', () => {
        const num = row.dataset.orden;
        window.location.href = `orden-detalle.html?orden=${encodeURIComponent(num)}`;
      });
    });
  },

  // ==================== UTILS ====================
  formatearFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },

  formatearHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },

  // ==================== REALTIME + POLLING ====================
  activarRealtime() {
    if (this.state.realtimeChannel) return;

    this.state.realtimeChannel = supabaseClient
      .channel('admin-tablero')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, () => this.cargarTodo())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios_orden' }, () => this.cargarTodo())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'historial_pausas' }, () => this.cargarTodo())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cancelaciones_orden' }, () => this.cargarTodo())
      .subscribe();

    Utils.log('Realtime admin activado');

    // Polling cada 15 segundos como fallback (solo cuando la pestaña está visible)
    this.iniciarPolling();
  },

  iniciarPolling() {
    if (this.state.pollingInterval) return;

    this.state.pollingInterval = setInterval(() => {
      // Solo refrescar si la pestaña está visible
      if (document.visibilityState === 'visible') {
        Utils.log('Polling: refrescando datos del tablero...');
        this.cargarTodo();
      }
    }, 15000);  // 15 segundos

    Utils.log('Polling iniciado (cada 15s)');
  },

  detenerPolling() {
    if (this.state.pollingInterval) {
      clearInterval(this.state.pollingInterval);
      this.state.pollingInterval = null;
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    console.error('Supabase no inicializado');
    return;
  }
  Admin.init();
});
