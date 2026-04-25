/**
 * orden-detalle.js — Pantalla de detalle de una orden (Fase 3b-1)
 *
 * Funciones:
 *  - Leer ?orden=OT-XXXX de la URL
 *  - Cargar todos los datos de la orden + vehículo + servicios + creador
 *  - Render según rol (lectura para todos por ahora)
 *  - Botón Volver respeta el rol del usuario
 *  - Realtime: si la orden cambia, actualiza
 *
 * Lo que NO hace todavía (Fase 3b-2):
 *  - Botones EMPEZAR/PAUSAR/TERMINAR
 *  - Cronómetros vivos por servicio
 *  - Edición de orden
 */

const OrdenDetalle = {

  state: {
    profile: null,
    numOrden: null,
    orden: null,
    vehiculo: null,
    servicios: [],
    serviciosCatalogo: [],
    creador: null,
    realtimeChannel: null,
  },

  // ==================== INIT ====================
  async init() {
    Utils.log('Iniciando detalle de orden...');

    const profile = await Auth.requireAuth();
    if (!profile) return;

    this.state.profile = profile;

    // Leer ?orden= de la URL
    const params = new URLSearchParams(window.location.search);
    const num = params.get('orden');

    if (!num) {
      this.mostrarError('No se especificó el número de orden.');
      return;
    }

    this.state.numOrden = num;

    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());
    document.getElementById('btn-back').addEventListener('click', () => this.volver());

    await this.cargarCatalogo();
    await this.cargarOrden();
    this.activarRealtime();
  },

  // ==================== VOLVER ====================
  volver() {
    const rol = this.state.profile.rol;
    if (rol === 'jefe_pista') {
      window.location.href = 'jefe.html';
    } else if (rol === 'tecnico') {
      window.location.href = 'tecnico.html';
    } else if (rol === 'admin') {
      window.location.href = 'admin.html';
    } else {
      history.back();
    }
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
          servicios_orden ( id, servicio_id, estado, tecnico_id, observacion )
        `)
        .eq('num_orden', this.state.numOrden)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        this.mostrarError(`La orden ${this.state.numOrden} no existe o fue eliminada.`);
        return;
      }

      this.state.orden = data;
      this.state.vehiculo = data.vehiculos;
      this.state.servicios = data.servicios_orden || [];

      // Cargar nombre del creador
      if (data.creada_por) {
        const { data: u } = await supabaseClient
          .from('usuarios')
          .select('nombre, codigo')
          .eq('id', data.creada_por)
          .maybeSingle();
        this.state.creador = u;
      }

      this.render();
    } catch (err) {
      Utils.log('Error cargando orden:', err);
      this.mostrarError('No se pudo cargar la orden. ' + (err.message || ''));
    }
  },

  // ==================== RENDER ====================
  render() {
    const o = this.state.orden;
    const v = this.state.vehiculo || {};

    document.getElementById('loading').hidden = true;
    document.getElementById('orden-content').hidden = false;

    document.getElementById('orden-titulo').textContent = `${o.placa} · ${o.num_orden}`;

    // Tarjeta vehículo
    document.getElementById('placa-grande').textContent = o.placa;
    const vTexto = `${v.marca || '—'} ${v.modelo || ''}${v.anio ? ' ' + v.anio : ''}`.trim();
    document.getElementById('vehiculo-meta').textContent = vTexto;

    // Badges
    const badgePrio = document.getElementById('badge-prioridad');
    badgePrio.textContent = o.prioridad === 'urgente' ? 'Urgente' : 'Normal';
    badgePrio.className = 'badge ' + (o.prioridad === 'urgente' ? 'badge-urgente' : 'badge-normal');

    const badgeEst = document.getElementById('badge-estado');
    if (o.estado === 'completada') {
      badgeEst.textContent = 'Completada';
      badgeEst.className = 'badge badge-completada';
    } else if (o.estado === 'en_progreso') {
      badgeEst.textContent = 'En proceso';
      badgeEst.className = 'badge badge-en-progreso';
    } else {
      badgeEst.textContent = 'Abierta';
      badgeEst.className = 'badge badge-abierta';
    }

    // Info grid
    document.getElementById('num-orden').textContent = o.num_orden;
    document.getElementById('km-ingreso').textContent = o.km_ingreso ? Number(o.km_ingreso).toLocaleString('es-HN') : '—';
    document.getElementById('creada-en').textContent = this.formatearFecha(o.creada_en);
    document.getElementById('creada-por').textContent = this.state.creador
      ? `${this.state.creador.nombre} (${this.state.creador.codigo})`
      : '—';

    // Bloques de texto
    document.getElementById('motivo').textContent = o.motivo || '—';
    if (o.problema) {
      document.getElementById('problema').textContent = o.problema;
      document.getElementById('problema-block').hidden = false;
    } else {
      document.getElementById('problema-block').hidden = true;
    }

    // Servicios
    this.renderServicios();
  },

  renderServicios() {
    const total = this.state.servicios.length;
    const completados = this.state.servicios.filter(s => s.estado === 'completado').length;

    document.getElementById('servicios-progress').textContent = `${completados}/${total}`;

    const cont = document.getElementById('servicios-list');

    if (total === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Sin servicios asignados.</p></div>';
      return;
    }

    cont.innerHTML = this.state.servicios.map(s => this.renderServicio(s)).join('');
  },

  renderServicio(s) {
    const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
    const nombre = cat?.nombre || 'Servicio';
    const tiempoBase = cat?.tiempo_promedio_min || null;

    let icono, txtEstado, claseEstado;
    switch (s.estado) {
      case 'completado':
        icono = '✓'; txtEstado = 'Completado'; claseEstado = 'completado';
        break;
      case 'en_progreso':
        icono = '▶'; txtEstado = 'En curso'; claseEstado = 'en-progreso';
        break;
      case 'pausado':
        icono = '‖'; txtEstado = 'Pausado'; claseEstado = 'pausado';
        break;
      default:
        icono = '○'; txtEstado = 'Pendiente'; claseEstado = 'pendiente';
    }

    const meta = tiempoBase ? `Mediana: ${tiempoBase} min` : 'Sin datos de tiempo';

    return `
      <div class="servicio-row">
        <div class="servicio-icono estado-${claseEstado}">${icono}</div>
        <div class="servicio-detalle">
          <div class="servicio-nombre-d">${Utils.escapeHtml(nombre)}</div>
          <div class="servicio-meta-d">${meta}</div>
        </div>
        <div class="servicio-estado-text txt-${claseEstado}">${txtEstado}</div>
      </div>
    `;
  },

  formatearFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes', filter: `num_orden=eq.${this.state.numOrden}` }, () => {
        Utils.log('Realtime: cambió la orden');
        this.cargarOrden();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios_orden' }, () => {
        Utils.log('Realtime: cambió un servicio');
        this.cargarOrden();
      })
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
