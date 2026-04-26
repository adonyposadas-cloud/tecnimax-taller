/**
 * orden-detalle.js — Detalle con botones por servicio (Fase 3b-2)
 *
 * UX por servicio:
 *  - Cada servicio tiene su propia card con su propio cronómetro y sus propios botones
 *  - El técnico puede manejar cada servicio independiente
 *
 * Schema real de historial_pausas:
 *  - id, servicio_orden_id, tecnico_id, motivo, detalle_repuesto, hora_pausa, hora_reanudacion
 *
 * Reglas de negocio:
 *  - Solo el técnico que inició un servicio puede pausarlo/terminarlo
 *  - Un técnico solo puede tener servicios EN_PROGRESO de UNA orden a la vez
 *  - Al pausar/terminar, se actualiza hora_reanudacion = NOW() de la pausa abierta
 *  - Tiempo real = (hora_fin - hora_inicio) - suma de duración de pausas
 */

const OrdenDetalle = {

  state: {
    profile: null,
    numOrden: null,
    orden: null,
    vehiculo: null,
    servicios: [],
    pausas: [],
    serviciosCatalogo: [],
    creador: null,
    tecnicos: {},
    realtimeChannel: null,
    cronometros: {},          // { servicioId: intervalId }
    motivoPausaSeleccionado: null,
    servicioAccionId: null,   // id del servicio sobre el que se hace acción
    serviciosAgregar: new Set(),
  },

  // ==================== INIT ====================
  async init() {
    Utils.log('Iniciando detalle de orden...');

    const profile = await Auth.requireAuth();
    if (!profile) return;
    this.state.profile = profile;

    const params = new URLSearchParams(window.location.search);
    const num = params.get('orden');
    if (!num) {
      this.mostrarError('No se especificó el número de orden.');
      return;
    }
    this.state.numOrden = num;

    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());
    document.getElementById('btn-back').addEventListener('click', () => this.volver());

    this.bindEventosModales();

    await this.cargarCatalogo();
    await this.cargarOrden();
    this.activarRealtime();
  },

  volver() {
    const rol = this.state.profile.rol;
    if (rol === 'jefe_pista') window.location.href = 'jefe.html';
    else if (rol === 'tecnico') window.location.href = 'tecnico.html';
    else if (rol === 'admin') window.location.href = 'admin.html';
    else history.back();
  },

  // ==================== CATÁLOGO ====================
  async cargarCatalogo() {
    try {
      const { data, error } = await supabaseClient
        .from('catalogo_servicios')
        .select('id, nombre, categoria_id, tiempo_promedio_min')
        .eq('activo', true);
      if (error) throw error;
      this.state.serviciosCatalogo = data || [];
    } catch (err) {
      Utils.log('Error cargando catálogo:', err);
    }
  },

  // ==================== ORDEN ====================
  async cargarOrden() {
    try {
      const { data, error } = await supabaseClient
        .from('ordenes')
        .select(`
          num_orden, placa, prioridad, estado, motivo, problema, km_ingreso,
          creada_en, cerrada_en, creada_por,
          vehiculos ( marca, modelo, anio, km_gps_actual ),
          servicios_orden ( id, servicio_id, estado, tecnico_id, hora_inicio, hora_fin,
                            tiempo_real_min, tiempo_asignado_min, sospechoso,
                            observacion, grupo_simultaneo_id )
        `)
        .eq('num_orden', this.state.numOrden)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        this.mostrarError(`La orden ${this.state.numOrden} no existe.`);
        return;
      }

      this.state.orden = data;
      this.state.vehiculo = data.vehiculos;
      this.state.servicios = data.servicios_orden || [];

      if (data.creada_por && (!this.state.creador || this.state.creador.id !== data.creada_por)) {
        const { data: u } = await supabaseClient
          .from('usuarios')
          .select('id, nombre, codigo')
          .eq('id', data.creada_por)
          .maybeSingle();
        this.state.creador = u;
      }

      await this.cargarPausas();
      await this.cargarTecnicos();
      this.render();
    } catch (err) {
      Utils.log('Error cargando orden:', err);
      this.mostrarError('No se pudo cargar la orden. ' + (err.message || ''));
    }
  },

  async cargarPausas() {
    const ids = this.state.servicios.map(s => s.id);
    if (ids.length === 0) {
      this.state.pausas = [];
      return;
    }
    try {
      const { data, error } = await supabaseClient
        .from('historial_pausas')
        .select('id, servicio_orden_id, tecnico_id, motivo, detalle_repuesto, hora_pausa, hora_reanudacion')
        .in('servicio_orden_id', ids)
        .order('hora_pausa', { ascending: false });
      if (error) throw error;
      this.state.pausas = data || [];
    } catch (err) {
      Utils.log('Error cargando pausas:', err);
      this.state.pausas = [];
    }
  },

  async cargarTecnicos() {
    const ids = [...new Set(this.state.servicios.map(s => s.tecnico_id).filter(Boolean))];
    if (ids.length === 0) {
      this.state.tecnicos = {};
      return;
    }
    try {
      const { data, error } = await supabaseClient
        .from('usuarios')
        .select('id, nombre, codigo')
        .in('id', ids);
      if (error) throw error;
      this.state.tecnicos = {};
      (data || []).forEach(u => { this.state.tecnicos[u.id] = u; });
    } catch (err) {
      Utils.log('Error cargando técnicos:', err);
      this.state.tecnicos = {};
    }
  },

  // ==================== HELPERS BUSINESS ====================
  /** ¿Hay servicios EN otra orden trabajados por este técnico? Solo cuenta los EN_PROGRESO, NO los pausados */
  async otraOrdenTengoTrabajando() {
    if (this.state.profile.rol !== 'tecnico') return null;
    try {
      const { data, error } = await supabaseClient
        .from('servicios_orden')
        .select('num_orden')
        .eq('tecnico_id', this.state.profile.id)
        .eq('estado', 'en_progreso');  // solo en_progreso, NO pausado
      if (error) throw error;
      const otras = (data || []).filter(s => s.num_orden !== this.state.numOrden);
      return otras.length > 0 ? otras[0].num_orden : null;
    } catch (err) {
      Utils.log('Error verificando otras órdenes:', err);
      return null;
    }
  },

  /** Calcula segundos pausados de un servicio sumando duraciones de pausas cerradas */
  segundosPausados(servicioId) {
    return this.state.pausas
      .filter(p => p.servicio_orden_id === servicioId && p.hora_reanudacion !== null)
      .reduce((acc, p) => {
        const dur = (new Date(p.hora_reanudacion) - new Date(p.hora_pausa)) / 1000;
        return acc + Math.max(0, dur);
      }, 0);
  },

  /** Pausa abierta de un servicio (la que aún no se reanuda) */
  pausaAbierta(servicioId) {
    return this.state.pausas
      .filter(p => p.servicio_orden_id === servicioId && p.hora_reanudacion === null)
      .sort((a, b) => new Date(b.hora_pausa) - new Date(a.hora_pausa))[0] || null;
  },

  // ==================== RENDER ====================
  render() {
    const o = this.state.orden;
    const v = this.state.vehiculo || {};

    document.getElementById('loading').hidden = true;
    document.getElementById('orden-content').hidden = false;

    document.getElementById('orden-titulo').textContent = `${o.placa} · ${o.num_orden}`;
    document.getElementById('placa-grande').textContent = o.placa;
    document.getElementById('vehiculo-meta').textContent =
      `${v.marca || '—'} ${v.modelo || ''}${v.anio ? ' ' + v.anio : ''}`.trim();

    const badgePrio = document.getElementById('badge-prioridad');
    badgePrio.textContent = o.prioridad === 'urgente' ? 'Urgente' : 'Normal';
    badgePrio.className = 'badge ' + (o.prioridad === 'urgente' ? 'badge-urgente' : 'badge-normal');

    const badgeEst = document.getElementById('badge-estado');
    if (o.estado === 'completada') {
      badgeEst.textContent = 'Completada'; badgeEst.className = 'badge badge-completada';
    } else if (o.estado === 'en_progreso') {
      badgeEst.textContent = 'En proceso'; badgeEst.className = 'badge badge-en-progreso';
    } else {
      badgeEst.textContent = 'Abierta'; badgeEst.className = 'badge badge-abierta';
    }

    document.getElementById('num-orden').textContent = o.num_orden;
    document.getElementById('km-ingreso').textContent = o.km_ingreso ? Number(o.km_ingreso).toLocaleString('es-HN') : '—';
    document.getElementById('creada-en').textContent = this.formatearFecha(o.creada_en);
    document.getElementById('creada-por').textContent = this.state.creador
      ? `${this.state.creador.nombre} (${this.state.creador.codigo})` : '—';

    document.getElementById('motivo').textContent = o.motivo || '—';
    if (o.problema) {
      document.getElementById('problema').textContent = o.problema;
      document.getElementById('problema-block').hidden = false;
    } else {
      document.getElementById('problema-block').hidden = true;
    }

    this.renderBannerInfo();
    this.renderServicios();
  },

  renderBannerInfo() {
    const userId = this.state.profile.id;
    const banner = document.getElementById('banner-info');
    const btnAdd = document.getElementById('btn-agregar-trabajo');

    if (this.state.profile.rol !== 'tecnico') {
      banner.hidden = true;
      return;
    }

    const enCurso = this.state.servicios.filter(
      s => s.tecnico_id === userId && s.estado === 'en_progreso'
    );
    const enPausa = this.state.servicios.filter(
      s => s.tecnico_id === userId && s.estado === 'pausado'
    );
    const totalActivos = enCurso.length + enPausa.length;

    if (totalActivos === 0) {
      banner.hidden = true;
      return;
    }

    banner.hidden = false;

    let txt = '';
    if (enCurso.length > 0 && enPausa.length > 0) {
      txt = `${enCurso.length} en curso · ${enPausa.length} pausado${enPausa.length !== 1 ? 's' : ''}`;
    } else if (enCurso.length > 0) {
      txt = `${enCurso.length} servicio${enCurso.length !== 1 ? 's' : ''} en curso`;
    } else {
      txt = `${enPausa.length} servicio${enPausa.length !== 1 ? 's' : ''} pausado${enPausa.length !== 1 ? 's' : ''}`;
    }
    document.getElementById('banner-stats').textContent = txt;

    // Mostrar "Agregar servicio" solo si hay pendientes Y al menos un activo
    const hayPendientes = this.state.servicios.some(s => s.estado === 'pendiente');
    btnAdd.hidden = !(hayPendientes && enCurso.length > 0);
  },

  renderServicios() {
    // Detener todos los cronómetros viejos antes de re-render
    this.detenerTodosCronometros();

    const total = this.state.servicios.length;
    const completados = this.state.servicios.filter(s => s.estado === 'completado').length;
    document.getElementById('servicios-progress').textContent = `${completados}/${total}`;

    const cont = document.getElementById('servicios-list');
    if (total === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Sin servicios asignados.</p></div>';
      return;
    }

    // Ordenar servicios:
    //   1) en_progreso (mis cronómetros corriendo)
    //   2) pausado (mis servicios pausados)
    //   3) pendiente (lo que falta)
    //   4) completado (histórico al final)
    // Dentro de cada grupo: los míos primero, luego por id ascendente
    const userId = this.state.profile.id;
    const ordenEstado = { 'en_progreso': 1, 'pausado': 2, 'pendiente': 3, 'completado': 4 };

    const ordenados = [...this.state.servicios].sort((a, b) => {
      const eA = ordenEstado[a.estado] || 99;
      const eB = ordenEstado[b.estado] || 99;
      if (eA !== eB) return eA - eB;
      // Dentro del mismo estado: los míos primero
      const aMio = a.tecnico_id === userId ? 0 : 1;
      const bMio = b.tecnico_id === userId ? 0 : 1;
      if (aMio !== bMio) return aMio - bMio;
      return a.id - b.id;
    });

    cont.innerHTML = ordenados.map(s => this.renderServicioCard(s)).join('');

    // Bindear botones
    cont.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.dataset.action;
        const sid = parseInt(btn.dataset.sid, 10);
        this.handleAction(action, sid);
      });
    });

    // Iniciar cronómetros para servicios en curso (del técnico actual)
    this.state.servicios.forEach(s => {
      if (s.tecnico_id === userId && s.estado === 'en_progreso' && s.hora_inicio) {
        this.iniciarCronometro(s);
      }
    });
  },

  renderServicioCard(s) {
    const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
    const nombre = cat?.nombre || 'Servicio';
    const mediana = cat?.tiempo_promedio_min || null;

    const userId = this.state.profile.id;
    const esMio = s.tecnico_id === userId;
    const esTecnico = this.state.profile.rol === 'tecnico';

    let icono, txtEstado;
    switch (s.estado) {
      case 'completado': icono = '✓'; txtEstado = 'Completado'; break;
      case 'en_progreso': icono = '▶'; txtEstado = 'En curso'; break;
      case 'pausado': icono = '‖'; txtEstado = 'Pausado'; break;
      default: icono = '○'; txtEstado = 'Pendiente';
    }

    const meta = mediana ? `Mediana: ${mediana} min` : 'Sin datos de tiempo';

    let html = `
      <div class="servicio-card estado-${s.estado.replace('_','-')}" data-sid="${s.id}">
        <div class="servicio-row-1">
          <div class="servicio-icono icon-${s.estado.replace('_','-')}">${icono}</div>
          <div class="servicio-detalle">
            <div class="servicio-nombre">${Utils.escapeHtml(nombre)}</div>
            <div class="servicio-meta">${meta}</div>
          </div>
          <div class="servicio-estado-text txt-${s.estado.replace('_','-')}">${txtEstado}</div>
        </div>
    `;

    // Cronómetro / info de pausa / tiempo final
    if (s.estado === 'en_progreso' && esMio) {
      html += `
        <div class="servicio-cronos">
          <div class="cronos-mini-display" id="cronos-${s.id}">00:00:00</div>
          <div class="cronos-mini-label">en curso</div>
        </div>
      `;
    } else if (s.estado === 'en_progreso' && !esMio) {
      const u = this.state.tecnicos[s.tecnico_id];
      html += `<div class="tecnico-tag otro">⏵ ${u ? Utils.escapeHtml(u.nombre) : 'Otro técnico'} trabajando</div>`;
    } else if (s.estado === 'pausado') {
      const pausa = this.pausaAbierta(s.id);
      const motivos = { repuesto: 'Esperando repuesto', cambio_unidad: 'Cambio de unidad', personal: 'Pausa personal' };
      const motivo = pausa ? (motivos[pausa.motivo] || pausa.motivo) : 'Pausado';
      const detalle = pausa?.detalle_repuesto ? `<div class="pausa-info-detalle">${Utils.escapeHtml(pausa.detalle_repuesto)}</div>` : '';
      html += `
        <div class="pausa-info-box">
          <div class="pausa-info-motivo">${motivo}</div>
          ${detalle}
        </div>
      `;
      if (!esMio) {
        const u = this.state.tecnicos[s.tecnico_id];
        html += `<div class="tecnico-tag otro">${u ? Utils.escapeHtml(u.nombre) : 'Otro técnico'}</div>`;
      }
    } else if (s.estado === 'completado') {
      const u = this.state.tecnicos[s.tecnico_id];
      const tiempoMin = s.tiempo_real_min ? `${s.tiempo_real_min} min` : '—';
      const sospechoso = s.sospechoso ? ' ⚠️' : '';
      const userTxt = u ? `${Utils.escapeHtml(u.nombre)}` : '—';
      html += `<div class="tecnico-tag otro">${userTxt} · ${tiempoMin}${sospechoso}</div>`;
      if (s.observacion) {
        html += `<div class="pausa-info-box" style="background: rgba(255,255,255,0.03); border-color: var(--border);">
                   <div class="pausa-info-detalle"><strong>Observación:</strong> ${Utils.escapeHtml(s.observacion)}</div>
                 </div>`;
      }
    }

    // Botones de acción según estado
    if (esTecnico && s.estado !== 'completado') {
      let acciones = '';

      if (s.estado === 'pendiente') {
        acciones = `<button class="btn-empezar" data-action="empezar" data-sid="${s.id}">EMPEZAR</button>`;
      } else if (s.estado === 'en_progreso' && esMio) {
        acciones = `
          <button class="btn-pausar" data-action="pausar" data-sid="${s.id}">PAUSAR</button>
          <button class="btn-terminar" data-action="terminar" data-sid="${s.id}">TERMINAR</button>
        `;
      } else if (s.estado === 'pausado' && esMio) {
        acciones = `
          <button class="btn-reanudar" data-action="reanudar" data-sid="${s.id}">REANUDAR</button>
          <button class="btn-terminar" data-action="terminar" data-sid="${s.id}">TERMINAR</button>
        `;
      }

      if (acciones) {
        html += `<div class="servicio-actions">${acciones}</div>`;
      }
    }

    html += '</div>';
    return html;
  },

  handleAction(action, sid) {
    switch (action) {
      case 'empezar': return this.abrirModalEmpezar(sid);
      case 'pausar': return this.abrirModalPausar(sid);
      case 'reanudar': return this.confirmarReanudar(sid);
      case 'terminar': return this.abrirModalTerminar(sid);
    }
  },

  // ==================== CRONÓMETROS ====================
  iniciarCronometro(servicio) {
    const id = servicio.id;
    if (this.state.cronometros[id]) return;
    if (!servicio.hora_inicio) return;

    const update = () => {
      const inicioMs = new Date(servicio.hora_inicio).getTime();
      const ahora = Date.now();
      const segPausados = this.segundosPausados(id);
      const transcurridoMs = ahora - inicioMs - (segPausados * 1000);
      if (transcurridoMs < 0) {
        const el = document.getElementById('cronos-' + id);
        if (el) el.textContent = '00:00:00';
        return;
      }
      const totalSeg = Math.floor(transcurridoMs / 1000);
      const h = Math.floor(totalSeg / 3600);
      const m = Math.floor((totalSeg % 3600) / 60);
      const s = totalSeg % 60;
      const fmt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      const el = document.getElementById('cronos-' + id);
      if (el) el.textContent = fmt;
    };

    update();
    this.state.cronometros[id] = setInterval(update, 1000);
  },

  detenerTodosCronometros() {
    Object.values(this.state.cronometros).forEach(intvl => clearInterval(intvl));
    this.state.cronometros = {};
  },

  // ==================== EMPEZAR ====================
  async abrirModalEmpezar(sid) {
    const s = this.state.servicios.find(x => x.id === sid);
    if (!s) return;
    this.state.servicioAccionId = sid;

    const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
    document.getElementById('empezar-resumen').innerHTML = `
      <div class="resumen-row">
        <span class="resumen-label">Servicio</span>
        <span class="resumen-value">${Utils.escapeHtml(cat?.nombre || 'Servicio')}</span>
      </div>
      ${cat?.tiempo_promedio_min ? `
      <div class="resumen-row">
        <span class="resumen-label">Estimado</span>
        <span class="resumen-value tiempo">~${cat.tiempo_promedio_min} min</span>
      </div>` : ''}
    `;

    document.getElementById('empezar-error').hidden = true;
    const btn = document.getElementById('btn-confirmar-empezar');
    btn.disabled = false;
    btn.textContent = 'EMPEZAR';

    // Verificar otra orden
    const otra = await this.otraOrdenTengoTrabajando();
    const warn = document.getElementById('empezar-warn');
    if (otra) {
      warn.textContent = `Tienes trabajo activo en la orden ${otra}. Termina o pausa ese antes de empezar uno nuevo.`;
      warn.hidden = false;
      btn.disabled = true;
    } else {
      warn.hidden = true;
    }

    document.getElementById('modal-empezar').hidden = false;
  },

  async confirmarEmpezar() {
    const sid = this.state.servicioAccionId;
    if (!sid) return;

    const btn = document.getElementById('btn-confirmar-empezar');
    btn.disabled = true;
    btn.textContent = 'Empezando...';

    try {
      const otra = await this.otraOrdenTengoTrabajando();
      if (otra) throw new Error(`Tienes trabajo en ${otra}`);

      const { error } = await supabaseClient
        .from('servicios_orden')
        .update({
          estado: 'en_progreso',
          tecnico_id: this.state.profile.id,
          hora_inicio: new Date().toISOString(),
        })
        .eq('id', sid)
        .eq('estado', 'pendiente');

      if (error) throw error;

      // Si la orden estaba abierta, ponerla en progreso
      if (this.state.orden.estado === 'abierta') {
        await supabaseClient
          .from('ordenes')
          .update({ estado: 'en_progreso' })
          .eq('num_orden', this.state.numOrden);
      }

      this.cerrarModales();
      await this.cargarOrden();
    } catch (err) {
      Utils.log('Error empezando:', err);
      this.errorEnModal('empezar-error', err.message || 'No se pudo empezar.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'EMPEZAR';
    }
  },

  // ==================== PAUSAR ====================
  abrirModalPausar(sid) {
    const s = this.state.servicios.find(x => x.id === sid);
    if (!s) return;
    this.state.servicioAccionId = sid;
    this.state.motivoPausaSeleccionado = null;

    const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
    document.getElementById('pausar-resumen').innerHTML = `
      <div class="resumen-row">
        <span class="resumen-label">Servicio a pausar</span>
        <span class="resumen-value">${Utils.escapeHtml(cat?.nombre || 'Servicio')}</span>
      </div>
    `;

    document.querySelectorAll('.motivo-btn').forEach(b => b.classList.remove('motivo-active'));
    document.getElementById('pausa-detalle').value = '';
    document.getElementById('campo-detalle').hidden = true;
    document.getElementById('pausa-error').hidden = true;
    document.getElementById('btn-confirmar-pausar').disabled = true;
    document.getElementById('modal-pausar').hidden = false;
  },

  async confirmarPausar() {
    const sid = this.state.servicioAccionId;
    const motivo = this.state.motivoPausaSeleccionado;
    const detalle = document.getElementById('pausa-detalle').value.trim() || null;

    if (!sid || !motivo) {
      this.errorEnModal('pausa-error', 'Selecciona un motivo.');
      return;
    }

    const btn = document.getElementById('btn-confirmar-pausar');
    btn.disabled = true;
    btn.textContent = 'Pausando...';

    try {
      // 1. Insertar registro de pausa
      const { error: pErr } = await supabaseClient
        .from('historial_pausas')
        .insert({
          servicio_orden_id: sid,
          tecnico_id: this.state.profile.id,
          motivo: motivo,
          detalle_repuesto: detalle,
          hora_pausa: new Date().toISOString(),
          // hora_reanudacion se queda NULL hasta que reanude
        });
      if (pErr) throw pErr;

      // 2. Cambiar estado del servicio a pausado
      const { error: sErr } = await supabaseClient
        .from('servicios_orden')
        .update({ estado: 'pausado' })
        .eq('id', sid);
      if (sErr) throw sErr;

      this.cerrarModales();
      await this.cargarOrden();
    } catch (err) {
      Utils.log('Error pausando:', err);
      this.errorEnModal('pausa-error', err.message || 'No se pudo pausar.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'PAUSAR';
    }
  },

  // ==================== REANUDAR ====================
  async confirmarReanudar(sid) {
    if (!sid) return;

    try {
      const ahora = new Date().toISOString();

      // 1. Cerrar la pausa abierta de este servicio
      const { error: pErr } = await supabaseClient
        .from('historial_pausas')
        .update({ hora_reanudacion: ahora })
        .eq('servicio_orden_id', sid)
        .is('hora_reanudacion', null);
      if (pErr) throw pErr;

      // 2. Cambiar estado del servicio
      const { error: sErr } = await supabaseClient
        .from('servicios_orden')
        .update({ estado: 'en_progreso' })
        .eq('id', sid);
      if (sErr) throw sErr;

      await this.cargarOrden();
    } catch (err) {
      Utils.log('Error reanudando:', err);
      alert('No se pudo reanudar: ' + (err.message || ''));
    }
  },

  // ==================== TERMINAR ====================
  abrirModalTerminar(sid) {
    const s = this.state.servicios.find(x => x.id === sid);
    if (!s) return;
    this.state.servicioAccionId = sid;

    const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
    document.getElementById('terminar-resumen').innerHTML = `
      <div class="resumen-row">
        <span class="resumen-label">Servicio</span>
        <span class="resumen-value">${Utils.escapeHtml(cat?.nombre || 'Servicio')}</span>
      </div>
    `;
    document.getElementById('terminar-observacion').value = '';
    document.getElementById('terminar-error').hidden = true;
    document.getElementById('btn-confirmar-terminar').disabled = false;
    document.getElementById('btn-confirmar-terminar').textContent = 'Terminar';
    document.getElementById('modal-terminar').hidden = false;
  },

  async confirmarTerminar() {
    const sid = this.state.servicioAccionId;
    if (!sid) return;

    const s = this.state.servicios.find(x => x.id === sid);
    if (!s) return;

    const observacion = document.getElementById('terminar-observacion').value.trim() || null;
    const btn = document.getElementById('btn-confirmar-terminar');
    btn.disabled = true;
    btn.textContent = 'Terminando...';

    try {
      const ahora = new Date().toISOString();

      // Si está pausado, primero cerrar la pausa abierta
      if (s.estado === 'pausado') {
        await supabaseClient
          .from('historial_pausas')
          .update({ hora_reanudacion: ahora })
          .eq('servicio_orden_id', sid)
          .is('hora_reanudacion', null);
        // Refrescar pausas para el cálculo
        await this.cargarPausas();
      }

      // Calcular tiempo real
      const inicioMs = new Date(s.hora_inicio).getTime();
      const finMs = new Date(ahora).getTime();
      const segPausados = this.segundosPausados(sid);
      const tiempoSeg = (finMs - inicioMs) / 1000 - segPausados;
      const tiempoMin = Math.max(1, Math.round(tiempoSeg / 60));

      // Sospechoso?
      const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
      const mediana = cat?.tiempo_promedio_min || null;
      let sospechoso = false;
      if (mediana && mediana > 0) {
        if (tiempoMin > mediana * 3 || tiempoMin < mediana * 0.1) sospechoso = true;
      }

      const { error } = await supabaseClient
        .from('servicios_orden')
        .update({
          estado: 'completado',
          hora_fin: ahora,
          tiempo_real_min: tiempoMin,
          sospechoso: sospechoso,
          observacion: observacion,
        })
        .eq('id', sid);
      if (error) throw error;

      // ¿Todos los servicios completados? -> cerrar orden
      const { data: todos } = await supabaseClient
        .from('servicios_orden')
        .select('estado')
        .eq('num_orden', this.state.numOrden);

      if ((todos || []).every(x => x.estado === 'completado')) {
        await supabaseClient
          .from('ordenes')
          .update({ estado: 'completada', cerrada_en: ahora })
          .eq('num_orden', this.state.numOrden);
      }

      this.cerrarModales();
      await this.cargarOrden();
    } catch (err) {
      Utils.log('Error terminando:', err);
      this.errorEnModal('terminar-error', err.message || 'No se pudo terminar.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Terminar';
    }
  },

  // ==================== AGREGAR AL TRABAJO ====================
  abrirModalAgregar() {
    this.state.serviciosAgregar = new Set();
    const pendientes = this.state.servicios.filter(s => s.estado === 'pendiente');

    const cont = document.getElementById('agregar-list');
    if (pendientes.length === 0) {
      cont.innerHTML = '<p class="modal-desc">No hay servicios pendientes en esta orden.</p>';
      document.getElementById('btn-confirmar-agregar').disabled = true;
      document.getElementById('modal-agregar').hidden = false;
      return;
    }

    cont.innerHTML = pendientes.map(s => {
      const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
      const nombre = cat?.nombre || 'Servicio';
      const tiempo = cat?.tiempo_promedio_min ? `~${cat.tiempo_promedio_min} min` : '';
      return `
        <label class="agregar-item" data-sid="${s.id}">
          <input type="checkbox" />
          <div style="flex: 1;">
            <div style="font-size: 0.9rem; font-weight: 500;">${Utils.escapeHtml(nombre)}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${tiempo}</div>
          </div>
        </label>
      `;
    }).join('');

    cont.querySelectorAll('.agregar-item').forEach(item => {
      const checkbox = item.querySelector('input');
      item.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') checkbox.checked = !checkbox.checked;
        const sid = parseInt(item.dataset.sid, 10);
        if (checkbox.checked) {
          this.state.serviciosAgregar.add(sid);
          item.classList.add('agregar-selected');
        } else {
          this.state.serviciosAgregar.delete(sid);
          item.classList.remove('agregar-selected');
        }
        document.getElementById('btn-confirmar-agregar').disabled = this.state.serviciosAgregar.size === 0;
      });
    });

    document.getElementById('btn-confirmar-agregar').disabled = true;
    document.getElementById('agregar-error').hidden = true;
    document.getElementById('modal-agregar').hidden = false;
  },

  async confirmarAgregar() {
    const ids = [...this.state.serviciosAgregar];
    if (ids.length === 0) return;

    const userId = this.state.profile.id;
    const enCurso = this.state.servicios.filter(
      s => s.tecnico_id === userId && s.estado === 'en_progreso'
    );
    if (enCurso.length === 0) {
      this.errorEnModal('agregar-error', 'No tienes servicio activo.');
      return;
    }

    let grupoId = enCurso[0].grupo_simultaneo_id;
    if (!grupoId) {
      grupoId = crypto.randomUUID();
      await supabaseClient
        .from('servicios_orden')
        .update({ grupo_simultaneo_id: grupoId })
        .in('id', enCurso.map(s => s.id));
    }

    const btn = document.getElementById('btn-confirmar-agregar');
    btn.disabled = true;
    btn.textContent = 'Agregando...';

    try {
      const { error } = await supabaseClient
        .from('servicios_orden')
        .update({
          estado: 'en_progreso',
          tecnico_id: userId,
          hora_inicio: new Date().toISOString(),
          grupo_simultaneo_id: grupoId,
        })
        .in('id', ids)
        .eq('estado', 'pendiente');
      if (error) throw error;

      this.cerrarModales();
      await this.cargarOrden();
    } catch (err) {
      Utils.log('Error agregando:', err);
      this.errorEnModal('agregar-error', err.message || 'No se pudo agregar.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Agregar';
    }
  },

  // ==================== EVENTOS MODALES ====================
  bindEventosModales() {
    document.getElementById('btn-cancelar-empezar').addEventListener('click', () => this.cerrarModales());
    document.getElementById('btn-confirmar-empezar').addEventListener('click', () => this.confirmarEmpezar());

    document.getElementById('btn-cancelar-pausar').addEventListener('click', () => this.cerrarModales());
    document.getElementById('btn-confirmar-pausar').addEventListener('click', () => this.confirmarPausar());
    document.querySelectorAll('.motivo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.motivo-btn').forEach(b => b.classList.remove('motivo-active'));
        btn.classList.add('motivo-active');
        this.state.motivoPausaSeleccionado = btn.dataset.motivo;
        document.getElementById('btn-confirmar-pausar').disabled = false;
        // Mostrar campo detalle solo si es repuesto
        document.getElementById('campo-detalle').hidden = btn.dataset.motivo !== 'repuesto';
      });
    });

    document.getElementById('btn-cancelar-terminar').addEventListener('click', () => this.cerrarModales());
    document.getElementById('btn-confirmar-terminar').addEventListener('click', () => this.confirmarTerminar());

    document.getElementById('btn-cancelar-agregar').addEventListener('click', () => this.cerrarModales());
    document.getElementById('btn-confirmar-agregar').addEventListener('click', () => this.confirmarAgregar());

    document.getElementById('btn-agregar-trabajo').addEventListener('click', () => this.abrirModalAgregar());

    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', () => this.cerrarModales());
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cerrarModales();
    });

    // Toggle de la tarjeta de info colapsable
    const headerToggle = document.getElementById('card-header-toggle');
    if (headerToggle) {
      headerToggle.addEventListener('click', () => this.toggleInfoCard());
    }
  },

  toggleInfoCard() {
    const card = document.getElementById('card-info');
    const body = document.getElementById('card-body-info');
    const isExpanded = card.classList.contains('expanded');
    if (isExpanded) {
      card.classList.remove('expanded');
      body.hidden = true;
    } else {
      card.classList.add('expanded');
      body.hidden = false;
    }
  },

  cerrarModales() {
    ['modal-empezar', 'modal-pausar', 'modal-terminar', 'modal-agregar'].forEach(id => {
      const m = document.getElementById(id);
      if (m) m.hidden = true;
    });
    this.state.servicioAccionId = null;
    this.state.motivoPausaSeleccionado = null;
    this.state.serviciosAgregar = new Set();
  },

  errorEnModal(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.hidden = false; }
  },

  // ==================== UTILS ====================
  formatearFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },

  mostrarError(msg) {
    document.getElementById('loading').hidden = true;
    document.getElementById('orden-content').hidden = true;
    document.getElementById('error-state').hidden = false;
    document.getElementById('error-msg-text').textContent = msg;
  },

  // ==================== REALTIME ====================
  activarRealtime() {
    if (this.state.realtimeChannel) return;

    this.state.realtimeChannel = supabaseClient
      .channel('orden-detalle-' + this.state.numOrden)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, () => this.cargarOrden())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios_orden' }, () => this.cargarOrden())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'historial_pausas' }, () => this.cargarOrden())
      .subscribe();

    Utils.log('Realtime activado para', this.state.numOrden);
  },
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    console.error('Supabase no inicializado');
    return;
  }
  OrdenDetalle.init();
});
