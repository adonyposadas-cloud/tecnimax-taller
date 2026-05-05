/**
 * tecnico.js — Vista del Técnico (Fase 3b-1)
 *
 * Funciones:
 *  - Cargar vehículos en taller (órdenes activas)
 *  - Buscador por placa o número de orden
 *  - Mostrar banner de "Trabajo activo" si tiene servicio en curso
 *  - Click en vehículo → abre detalle
 *  - Realtime: actualización automática
 *
 * Lo que NO hace todavía (Fase 3b-2):
 *  - Botones EMPEZAR/PAUSAR/TERMINAR
 *  - Cronómetro vivo (solo se muestra el banner si hay trabajo activo)
 */

const Tecnico = {

  state: {
    profile: null,
    ordenes: [],
    todasLasOrdenes: [],
    serviciosCatalogo: [],
    busqueda: '',
    realtimeChannel: null,
    cronometroInterval: null,
    servicioActivo: null,
    tabActiva: 'taller',  // 'taller' | 'entregar'
  },

  // ==================== INIT ====================
  async init() {
    Utils.log('Iniciando vista Técnico...');

    const profile = await Auth.requireAuth();
    if (!profile) return;

    if (profile.rol !== 'tecnico' && profile.rol !== 'admin') {
      alert('No tienes permisos para esta pantalla.');
      Auth.logout();
      return;
    }

    this.state.profile = profile;
    document.getElementById('user-nombre-header').textContent = profile.nombre;

    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

    this.inyectarTabs();
    await this.cargarCatalogoServicios();
    await this.cargarOrdenes();
    this.bindEventos();
    this.activarRealtime();
  },

  /**
   * Inyecta dinámicamente las tabs "En taller" / "Listas p/ entregar"
   * justo antes de la lista de vehículos. Se hace en JS (no en HTML)
   * para no requerir cambios al tecnico.html.
   */
  inyectarTabs() {
    const list = document.getElementById('vehiculos-list');
    if (!list || document.getElementById('tecnico-tabs')) return;

    const tabsHtml = `
      <div id="tecnico-tabs" class="tecnico-tabs">
        <button class="tecnico-tab tecnico-tab-active" data-tab="taller" type="button">
          <span class="tecnico-tab-icon">🔧</span>
          <span class="tecnico-tab-label">En taller</span>
          <span class="tecnico-tab-count" id="tab-count-taller">0</span>
        </button>
        <button class="tecnico-tab" data-tab="entregar" type="button">
          <span class="tecnico-tab-icon">🚗</span>
          <span class="tecnico-tab-label">Listas p/ entregar</span>
          <span class="tecnico-tab-count tecnico-tab-count-entregar" id="tab-count-entregar">0</span>
        </button>
      </div>`;
    list.insertAdjacentHTML('beforebegin', tabsHtml);

    document.querySelectorAll('.tecnico-tab').forEach(btn => {
      btn.addEventListener('click', () => this.cambiarTab(btn.dataset.tab));
    });
  },

  cambiarTab(tab) {
    if (tab !== 'taller' && tab !== 'entregar') return;
    if (this.state.tabActiva === tab) return;
    this.state.tabActiva = tab;

    document.querySelectorAll('.tecnico-tab').forEach(btn => {
      btn.classList.toggle('tecnico-tab-active', btn.dataset.tab === tab);
    });

    this.aplicarFiltro();
  },

  // ==================== CATÁLOGO ====================
  async cargarCatalogoServicios() {
    try {
      const { data, error } = await supabaseClient
        .from('catalogo_servicios')
        .select('id, nombre, categoria_id')
        .eq('activo', true);
      if (error) throw error;
      this.state.serviciosCatalogo = data || [];
    } catch (err) {
      Utils.log('Error cargando catálogo:', err);
    }
  },

  // ==================== ÓRDENES ====================
  async cargarOrdenes() {
    try {
      const { data, error } = await supabaseClient
        .from('ordenes')
        .select(`
          num_orden, placa, prioridad, estado, motivo, creada_en, entregada_en,
          vehiculos ( marca, modelo, anio ),
          servicios_orden ( id, estado, servicio_id, tecnico_id, hora_inicio )
        `)
        .in('estado', ['abierta', 'en_progreso', 'completada'])
        .order('creada_en', { ascending: false });

      if (error) throw error;

      // Filtrar localmente: descartamos las completadas YA entregadas
      // (las completadas pendientes de entrega sí las queremos en la lista)
      this.state.todasLasOrdenes = (data || []).filter(o =>
        o.estado !== 'completada' || !o.entregada_en
      );
      this.aplicarFiltro();
      this.detectarServicioActivo();
    } catch (err) {
      Utils.log('Error cargando órdenes:', err);
    }
  },

  aplicarFiltro() {
    const q = this.state.busqueda.trim().toLowerCase();

    // Filtro por búsqueda (placa o número)
    let filtradas = !q
      ? this.state.todasLasOrdenes
      : this.state.todasLasOrdenes.filter(o =>
          o.placa.toLowerCase().includes(q) ||
          o.num_orden.toLowerCase().includes(q)
        );

    // Calcular contadores de cada tab (después de búsqueda, antes de filtrar por tab)
    const enTaller = filtradas.filter(o => !(o.estado === 'completada' && !o.entregada_en));
    const listasEntregar = filtradas.filter(o => o.estado === 'completada' && !o.entregada_en);

    // Actualizar contadores en las tabs
    const setTabCount = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setTabCount('tab-count-taller', enTaller.length);
    setTabCount('tab-count-entregar', listasEntregar.length);

    // Toggle de "destacado" del badge según haya entregas pendientes
    const tabEntregar = document.querySelector('.tecnico-tab[data-tab="entregar"]');
    if (tabEntregar) {
      tabEntregar.classList.toggle('tecnico-tab-con-pendientes', listasEntregar.length > 0);
    }

    // Aplicar filtro por tab activa
    this.state.ordenes = this.state.tabActiva === 'entregar' ? listasEntregar : enTaller;
    this.renderLista();
  },

  detectarServicioActivo() {
    // Busca un servicio en estado 'en_progreso' asignado al técnico actual
    const userId = this.state.profile.id;
    let servicioActivo = null;
    let ordenActiva = null;

    for (const orden of this.state.todasLasOrdenes) {
      const servicio = (orden.servicios_orden || []).find(
        s => s.estado === 'en_progreso' && s.tecnico_id === userId
      );
      if (servicio) {
        servicioActivo = servicio;
        ordenActiva = orden;
        break;
      }
    }

    const banner = document.getElementById('banner-activo');
    if (servicioActivo && ordenActiva) {
      const cat = this.state.serviciosCatalogo.find(c => c.id === servicioActivo.servicio_id);
      const nombreServ = cat?.nombre || 'Servicio';

      document.getElementById('banner-orden').textContent = `${ordenActiva.placa} · ${ordenActiva.num_orden}`;
      document.getElementById('banner-servicio').textContent = nombreServ;
      banner.hidden = false;

      this.state.servicioActivo = servicioActivo;
      this.iniciarCronometroBanner(servicioActivo);
    } else {
      banner.hidden = true;
      this.state.servicioActivo = null;
      this.detenerCronometroBanner();
    }
  },

  iniciarCronometroBanner(servicio) {
    this.detenerCronometroBanner();
    if (!servicio.hora_inicio) {
      document.getElementById('banner-cronos').textContent = '00:00:00';
      document.getElementById('banner-status').textContent = 'en curso';
      return;
    }

    // FIX: si el servicio cruzó la medianoche, el cronómetro del banner muestra
    // solo el tiempo trabajado HOY (desde hoy 00:00), no el acumulado.
    // Coherente con el cronómetro de la pantalla de detalle.
    const inicioMs = new Date(servicio.hora_inicio).getTime();

    const update = () => {
      const ahora = Date.now();
      const hoyCero = new Date();
      hoyCero.setHours(0, 0, 0, 0);
      const inicioEfectivoMs = Math.max(inicioMs, hoyCero.getTime());

      const transcurridoMs = ahora - inicioEfectivoMs;
      if (transcurridoMs < 0) {
        document.getElementById('banner-cronos').textContent = '00:00:00';
        return;
      }
      const totalSeg = Math.floor(transcurridoMs / 1000);
      const h = Math.floor(totalSeg / 3600);
      const m = Math.floor((totalSeg % 3600) / 60);
      const s = totalSeg % 60;
      const fmt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      document.getElementById('banner-cronos').textContent = fmt;
      document.getElementById('banner-status').textContent = 'en curso';
    };

    update();
    this.state.cronometroInterval = setInterval(update, 1000);
  },

  detenerCronometroBanner() {
    if (this.state.cronometroInterval) {
      clearInterval(this.state.cronometroInterval);
      this.state.cronometroInterval = null;
    }
  },

  // ==================== RENDER ====================
  renderLista() {
    const list = document.getElementById('vehiculos-list');
    const count = document.getElementById('vehiculos-count');

    // Ordenar:
    //   1. Urgentes primero (ajenas o no, urgencia manda)
    //   2. Mis órdenes con servicio en_progreso
    //   3. Mis órdenes con servicio pausado
    //   4. Resto, por fecha desc
    const userId = this.state.profile.id;
    const ords = [...this.state.ordenes].sort((a, b) => {
      // 0. Listas para entregar arriba de todo (motorista esperando = urgencia operativa)
      const aLista = a.estado === 'completada' && !a.entregada_en;
      const bLista = b.estado === 'completada' && !b.entregada_en;
      if (aLista !== bLista) return aLista ? -1 : 1;
      // 1. Urgentes primero
      if (a.prioridad !== b.prioridad) {
        return a.prioridad === 'urgente' ? -1 : 1;
      }
      // 2. Mis en_progreso
      const aMiaProgreso = (a.servicios_orden || []).some(s => s.tecnico_id === userId && s.estado === 'en_progreso');
      const bMiaProgreso = (b.servicios_orden || []).some(s => s.tecnico_id === userId && s.estado === 'en_progreso');
      if (aMiaProgreso !== bMiaProgreso) return aMiaProgreso ? -1 : 1;
      // 3. Mis pausados
      const aMiaPausada = (a.servicios_orden || []).some(s => s.tecnico_id === userId && s.estado === 'pausado');
      const bMiaPausada = (b.servicios_orden || []).some(s => s.tecnico_id === userId && s.estado === 'pausado');
      if (aMiaPausada !== bMiaPausada) return aMiaPausada ? -1 : 1;
      // 4. Fecha desc
      return new Date(b.creada_en) - new Date(a.creada_en);
    });

    count.textContent = ords.length;

    if (ords.length === 0) {
      let mensaje, sub = '';
      if (this.state.busqueda) {
        mensaje = 'No se encontraron vehículos con ese criterio.';
      } else if (this.state.tabActiva === 'entregar') {
        mensaje = 'No hay vehículos listos para entregar.';
        sub = '<p style="color: var(--text-dim); font-size: 0.85rem; margin-top: 0.5rem;">Cuando termines todos los servicios de una orden, aparecerá aquí.</p>';
      } else {
        mensaje = 'Sin vehículos en taller en este momento.';
        sub = '<p style="color: var(--text-dim); font-size: 0.85rem; margin-top: 0.5rem;">Cuando el jefe cree una orden, aparecerá aquí.</p>';
      }
      list.innerHTML = `<div class="empty-state"><p>${mensaje}</p>${sub}</div>`;
      return;
    }

    list.innerHTML = ords.map(o => this.renderCard(o)).join('');

    list.querySelectorAll('.vehiculo-card').forEach(card => {
      card.addEventListener('click', () => {
        const num = card.dataset.orden;
        if (num) {
          window.location.href = `orden-detalle.html?orden=${encodeURIComponent(num)}`;
        }
      });
    });
  },

  renderCard(orden) {
    const userId = this.state.profile.id;
    const servicios = orden.servicios_orden || [];
    const total = servicios.length;
    const completados = servicios.filter(s => s.estado === 'completado').length;

    const estadoMia = servicios.find(s => s.tecnico_id === userId && s.estado === 'en_progreso');
    const otroEnProgreso = servicios.find(s => s.tecnico_id !== userId && s.estado === 'en_progreso');
    const algunaPendiente = servicios.some(s => s.estado === 'pendiente');

    const v = orden.vehiculos || {};
    const vehiculoTexto = `${v.marca || ''} ${v.modelo || ''}${v.anio ? ' ' + v.anio : ''}`.trim() || '—';

    const nombresServ = servicios
      .map(s => this.state.serviciosCatalogo.find(c => c.id === s.servicio_id)?.nombre)
      .filter(Boolean)
      .slice(0, 3)
      .join(' · ');

    let cardClass = 'vehiculo-card';
    const listaEntregar = orden.estado === 'completada' && !orden.entregada_en;
    if (listaEntregar) cardClass += ' card-lista-entregar';
    if (orden.prioridad === 'urgente' && !listaEntregar) cardClass += ' card-urgente';
    if (estadoMia) cardClass += ' card-mio';
    // Orden trabajada por otro técnico (y no por mí) → atenuar
    if (otroEnProgreso && !estadoMia) cardClass += ' card-otro';

    let badgeHtml;
    if (listaEntregar) {
      badgeHtml = '<span class="badge-mini badge-lista-entregar">🚗 LISTA P/ ENTREGAR</span>';
    } else if (orden.prioridad === 'urgente') {
      badgeHtml = '<span class="badge-mini badge-urgente">Urgente</span>';
    } else {
      badgeHtml = '<span class="badge-mini badge-normal">Normal</span>';
    }

    // Contador completados/total con colores semánticos:
    //   verde = completados, rojo = total
    // Se muestra siempre que la orden tenga servicios (incluso 0/N).
    const contadorHtml = total > 0
      ? `<span class="contador-completados">${completados}</span><span class="contador-sep">/</span><span class="contador-total">${total}</span>`
      : '';

    let statusHtml = '';
    if (listaEntregar) {
      statusHtml = '<div class="card-status status-lista-entregar">✓ Trabajo terminado · Toca para entregar al motorista</div>';
    } else if (estadoMia) {
      statusHtml = '<div class="card-status status-mio">▶ Tú estás trabajando aquí</div>';
    } else if (otroEnProgreso) {
      statusHtml = `<div class="card-status status-asignado">Otro técnico trabajando · ${contadorHtml}</div>`;
    } else if (algunaPendiente && completados === 0) {
      statusHtml = `<div class="card-status status-libre">Sin asignar · Disponible · ${contadorHtml} servicios</div>`;
    } else if (completados < total) {
      statusHtml = `<div class="card-status status-asignado">${contadorHtml} servicios</div>`;
    } else if (total > 0) {
      // Por si acaso: todos completados pero la orden aún no se cerró
      statusHtml = `<div class="card-status status-asignado">${contadorHtml} servicios</div>`;
    }

    return `
      <div class="${cardClass}" data-orden="${Utils.escapeHtml(orden.num_orden)}">
        <div class="card-row-1">
          <div class="placa-card">${Utils.escapeHtml(orden.placa)}</div>
          ${badgeHtml}
        </div>
        <div class="card-meta">${Utils.escapeHtml(vehiculoTexto)} · ${Utils.escapeHtml(orden.num_orden)}</div>
        <div class="card-servicios">${Utils.escapeHtml(nombresServ || orden.motivo || '—')}</div>
        ${statusHtml}
      </div>
    `;
  },

  // ==================== EVENTOS ====================
  bindEventos() {
    const search = document.getElementById('search-input');
    let debounce;
    search.addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.state.busqueda = e.target.value;
        this.aplicarFiltro();
      }, 200);
    });

    // Click en banner activo -> abre la orden
    document.getElementById('banner-activo').addEventListener('click', () => {
      const txt = document.getElementById('banner-orden').textContent;
      const m = txt.match(/(OT-\d+)/);
      if (m) {
        window.location.href = `orden-detalle.html?orden=${encodeURIComponent(m[1])}`;
      }
    });
  },

  // ==================== REALTIME ====================
  activarRealtime() {
    if (this.state.realtimeChannel) return;

    this.state.realtimeChannel = supabaseClient
      .channel('tecnico-ordenes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, () => {
        Utils.log('Realtime: cambio en ordenes');
        this.cargarOrdenes();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios_orden' }, () => {
        Utils.log('Realtime: cambio en servicios_orden');
        this.cargarOrdenes();
      })
      .subscribe();

    Utils.log('Realtime activado');
  },
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    console.error('Supabase no inicializado');
    return;
  }
  Tecnico.init();
});
