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

  state: {
    profile: null,
    rango: 'hoy',  // 'hoy' | 'semana' | 'mes'
    fechaDesde: null,
    fechaHasta: null,

    ordenes: [],
    servicios: [],
    pausas: [],
    cancelaciones: [],
    usuarios: [],
    serviciosCatalogo: [],

    realtimeChannel: null,
    cronometros: {},  // { tecnicoId: intervalId }
  },

  // ==================== INIT ====================
  async init() {
    Utils.log('Iniciando panel admin...');

    const profile = await Auth.requireAuth();
    if (!profile) return;

    if (profile.rol !== 'admin') {
      alert('No tienes permisos para ver este panel.');
      window.location.href = profile.rol === 'jefe_pista' ? 'jefe.html' : 'tecnico.html';
      return;
    }

    this.state.profile = profile;
    document.getElementById('user-nombre-header').textContent = profile.nombre || 'Administración';
    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

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
        if (r === this.state.rango) return;

        document.querySelectorAll('.rango-tab').forEach(t => t.classList.remove('rango-active'));
        tab.classList.add('rango-active');
        this.state.rango = r;
        this.calcularRango();
        this.actualizarRangoInfo();
        this.cargarTodo();
      });
    });

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
  },

  // ==================== RANGOS ====================
  calcularRango() {
    const ahora = new Date();
    const desde = new Date(ahora);

    if (this.state.rango === 'hoy') {
      desde.setHours(0, 0, 0, 0);
    } else if (this.state.rango === 'semana') {
      // Lunes 00:00 de esta semana
      const diaSemana = desde.getDay();  // 0=domingo, 1=lunes...
      const diff = diaSemana === 0 ? 6 : diaSemana - 1;
      desde.setDate(desde.getDate() - diff);
      desde.setHours(0, 0, 0, 0);
    } else if (this.state.rango === 'mes') {
      desde.setDate(1);
      desde.setHours(0, 0, 0, 0);
    }

    this.state.fechaDesde = desde.toISOString();
    this.state.fechaHasta = new Date().toISOString();

    // Labels en las secciones
    const labels = { hoy: 'hoy', semana: 'esta semana', mes: 'este mes' };
    document.getElementById('prod-rango-label').textContent = labels[this.state.rango];
    document.getElementById('canc-rango-label').textContent = labels[this.state.rango];
  },

  actualizarRangoInfo() {
    const desde = new Date(this.state.fechaDesde);
    const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    document.getElementById('rango-info').textContent = `Desde ${fmt(desde)}`;
  },

  // ==================== CARGA DE DATOS ====================
  async cargarTodo() {
    try {
      await Promise.all([
        this.cargarCatalogo(),
        this.cargarUsuarios(),
        this.cargarOrdenes(),
        this.cargarServicios(),
        this.cargarPausas(),
        this.cargarCancelaciones(),
      ]);

      this.renderKPIs();
      this.renderAlertas();
      this.renderTecnicos();
      this.renderProductividad();
      this.renderCancelaciones();
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
      .select('num_orden, placa, prioridad, estado, motivo, creada_en, cerrada_en, creada_por');
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

  enRango(fechaIso) {
    if (!fechaIso) return false;
    const f = new Date(fechaIso);
    return f >= new Date(this.state.fechaDesde) && f <= new Date(this.state.fechaHasta);
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
    // Detener cronómetros viejos
    Object.values(this.state.cronometros).forEach(i => clearInterval(i));
    this.state.cronometros = {};

    const tecnicos = this.state.usuarios.filter(u => u.rol === 'tecnico');
    const cont = document.getElementById('tecnicos-list');

    if (tecnicos.length === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Sin técnicos activos.</p></div>';
      document.getElementById('tecnicos-stats').textContent = '0';
      return;
    }

    let trabajando = 0, pausado = 0, libre = 0;

    const html = tecnicos.map(t => {
      // Su servicio EN_PROGRESO actual (si hay)
      const servActivo = this.state.servicios.find(
        s => s.tecnico_id === t.id && s.estado === 'en_progreso'
      );
      // O su servicio PAUSADO
      const servPausado = !servActivo
        ? this.state.servicios.find(s => s.tecnico_id === t.id && s.estado === 'pausado')
        : null;

      let estado, statusClass, cardClass, actividad, tiempoHtml;

      if (servActivo) {
        trabajando++;
        estado = 'Trabajando';
        statusClass = 'status-trabajando';
        cardClass = 'tec-trabajando';
        const orden = this.state.ordenes.find(o => o.num_orden === servActivo.num_orden);
        actividad = `${orden ? orden.placa + ' · ' : ''}${this.nombreServicio(servActivo.servicio_id)}`;
        tiempoHtml = `<div class="tecnico-tiempo" id="cron-${t.id}">00:00:00</div>`;
      } else if (servPausado) {
        pausado++;
        estado = 'Pausado';
        statusClass = 'status-pausado';
        cardClass = 'tec-pausado';
        const orden = this.state.ordenes.find(o => o.num_orden === servPausado.num_orden);
        const pausa = this.pausaAbierta(servPausado.id);
        const motivos = {
          repuesto: 'Repuesto', cambio_unidad: 'Cambio unidad',
          personal: 'Personal', reasignacion_jefe: 'Reasignación'
        };
        const motivo = pausa ? (motivos[pausa.motivo] || pausa.motivo) : '';
        actividad = `${orden ? orden.placa + ' · ' : ''}${this.nombreServicio(servPausado.servicio_id)}${motivo ? ' (' + motivo + ')' : ''}`;
        tiempoHtml = `<div class="tecnico-tiempo" style="color: var(--amarillo);">${motivo}</div>`;
      } else {
        libre++;
        estado = 'Libre';
        statusClass = 'status-libre';
        cardClass = 'tec-libre';
        actividad = 'Sin trabajo asignado';
        tiempoHtml = '';
      }

      return `
        <div class="tecnico-card ${cardClass}">
          <div class="tecnico-status ${statusClass}"></div>
          <div class="tecnico-info">
            <div class="tecnico-nombre">${Utils.escapeHtml(t.nombre)}</div>
            <div class="tecnico-actividad">${Utils.escapeHtml(actividad)}</div>
          </div>
          ${tiempoHtml}
        </div>
      `;
    }).join('');

    cont.innerHTML = html;

    document.getElementById('tecnicos-stats').textContent =
      `${trabajando} trabajando · ${pausado} pausados · ${libre} libres`;

    // Iniciar cronómetros para los técnicos trabajando
    tecnicos.forEach(t => {
      const servActivo = this.state.servicios.find(
        s => s.tecnico_id === t.id && s.estado === 'en_progreso'
      );
      if (servActivo && servActivo.hora_inicio) {
        this.iniciarCronometroTecnico(t.id, servActivo);
      }
    });
  },

  iniciarCronometroTecnico(tecnicoId, servicio) {
    const update = () => {
      const inicioMs = new Date(servicio.hora_inicio).getTime();
      const ahora = Date.now();
      const segPausados = this.segundosPausados(servicio.id);
      const transcurridoMs = ahora - inicioMs - (segPausados * 1000);
      if (transcurridoMs < 0) {
        const el = document.getElementById('cron-' + tecnicoId);
        if (el) el.textContent = '00:00:00';
        return;
      }
      const totalSeg = Math.floor(transcurridoMs / 1000);
      const h = Math.floor(totalSeg / 3600);
      const m = Math.floor((totalSeg % 3600) / 60);
      const s = totalSeg % 60;
      const fmt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      const el = document.getElementById('cron-' + tecnicoId);
      if (el) el.textContent = fmt;
    };

    update();
    this.state.cronometros[tecnicoId] = setInterval(update, 1000);
  },

  // ==================== 4. PRODUCTIVIDAD ====================
  renderProductividad() {
    const tecnicos = this.state.usuarios.filter(u => u.rol === 'tecnico');
    const cont = document.getElementById('productividad-list');

    // Servicios completados en el rango
    const completadosRango = this.state.servicios.filter(
      s => s.estado === 'completado' && this.enRango(s.hora_fin)
    );

    if (completadosRango.length === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Sin servicios completados en este rango.</p></div>';
      return;
    }

    // Agrupar por técnico
    const stats = {};
    tecnicos.forEach(t => {
      stats[t.id] = {
        nombre: t.nombre,
        codigo: t.codigo,
        servicios: 0,
        tiempoReal: 0,
        tiempoEsperado: 0,
      };
    });

    completadosRango.forEach(s => {
      if (!stats[s.tecnico_id]) return;
      stats[s.tecnico_id].servicios += 1;
      stats[s.tecnico_id].tiempoReal += s.tiempo_real_min || 0;

      const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
      const mediana = cat?.tiempo_promedio_min || 0;
      stats[s.tecnico_id].tiempoEsperado += mediana;
    });

    // Filtrar técnicos con al menos 1 servicio
    const filas = Object.values(stats)
      .filter(x => x.servicios > 0)
      .sort((a, b) => b.servicios - a.servicios);

    if (filas.length === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Sin servicios completados por técnicos en este rango.</p></div>';
      return;
    }

    let html = `
      <div class="prod-row prod-header">
        <div>Técnico</div>
        <div>Servicios</div>
        <div>Tiempo total</div>
        <div>Esperado</div>
        <div>Eficiencia</div>
      </div>
    `;

    html += filas.map(x => {
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

      const tiempoTxt = x.tiempoReal >= 60
        ? `${Math.floor(x.tiempoReal / 60)}h ${x.tiempoReal % 60}m`
        : `${x.tiempoReal} min`;

      const espTxt = x.tiempoEsperado >= 60
        ? `${Math.floor(x.tiempoEsperado / 60)}h ${x.tiempoEsperado % 60}m`
        : `${x.tiempoEsperado} min`;

      return `
        <div class="prod-row">
          <div class="prod-tecnico">${Utils.escapeHtml(x.nombre)}</div>
          <div class="prod-numero">${x.servicios}</div>
          <div class="prod-numero">${tiempoTxt}</div>
          <div class="prod-numero">${espTxt}</div>
          <div class="prod-eficiencia ${efClass}">${eficiencia}</div>
        </div>
      `;
    }).join('');

    cont.innerHTML = html;
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

  // ==================== REALTIME ====================
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
  },
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    console.error('Supabase no inicializado');
    return;
  }
  Admin.init();
});
