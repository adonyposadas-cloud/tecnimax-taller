
APP de tiempos B
/
Claude ha terminado la respuesta
1780332197459_image.png
1780332223225_image.png
Necesito que al técnico le aparezcan las prioridad urgente de primero, luego la orden donde esta trabajando actualmente, después que le aparezcan las ordenes que tiene pausadas y después las restantes,

10:54 a.m.

Identificó necesidad de archivo para reordenar órdenes del técnico
Identificó necesidad de archivo para reordenar órdenes del técnico
Para implementar ese orden necesito ver cómo estás cargando y ordenando las órdenes actualmente. Súbeme el archivo tecnico.js (y si la lógica de render del listado está en otro lado, también ese archivo).

Con eso te devuelvo el archivo completo listo para subir, aplicando este orden de prioridad en el listado "VEHÍCULOS EN TALLER":

Urgentes (prioridad urgente) primero
La orden donde el técnico está trabajando ahora ("Tú estás trabajando aquí")
Las órdenes que el técnico tiene pausadas
El resto
Antes de hacerlo, una duda para que el orden quede exacto:

¿Las "urgentes" deben ir siempre arriba del todo, incluso por encima de la orden en la que está trabajando actualmente? ¿O quieres que la orden activa actual siempre sea la primera y luego las urgentes?


tecnico.js
js

la orden activa actual siempre sea la primera y luego las urgentes, si asi es mejor

10:56 a.m.

Restructuró lógica de ordenamiento para priorizar orden activa
Restructuró lógica de ordenamiento para priorizar orden activa
Perfecto, entiendo el orden definitivo:

Mi orden activa (donde estoy trabajando ahora) — siempre primera
Urgentes
Mis órdenes pausadas
Resto
(Completadas siguen al final, como ya estaban)
El cambio está solo en el bloque de ordenamiento de renderLista(). Reemplacé la cadena de comparaciones por una lógica de "grupos" más clara y robusta (cada orden recibe un número de grupo y se ordena por grupo, y dentro de cada grupo por fecha descendente).

Te dejo el archivo completo listo para subir.


Ejecutó 2 comandos, archivo editado, leyó un archivo
Ejecutó 2 comandos, archivo editado, leyó un archivo
Listo. Lo único que cambió fue el bloque de ordenamiento dentro de renderLista(); todo lo demás quedó idéntico.

Cómo queda el orden en "VEHÍCULOS EN TALLER":

La orden donde el técnico está trabajando ahora (su servicio en_progreso)
Las urgentes
Sus órdenes pausadas
El resto
Completadas al final (esperando confirmación de GPS, como ya estaba)
Dos detalles de la lógica, por si los quieres ajustar:

Si una orden es a la vez tu activa y urgente, queda en el grupo 1 (activa), o sea de primera — que es justo lo que pediste. Y si una orden urgente también la tienes pausada, manda lo urgente sobre lo pausado.

Recordatorio: súbelo por GitHub y súbele la versión al service worker para que no quede cacheado el tecnico.js viejo.


Tecnico
JS 







Claude es IA y puede cometer errores. Por favor, verifica las respuestas.
Tecnico · JS
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
    placasConMovimiento: new Set(),  // placas que ya reportaron movimiento GPS post-cierre
    busqueda: '',
    realtimeChannel: null,
    cronometroInterval: null,
    servicioActivo: null,
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
 
    await this.cargarCatalogoServicios();
    await this.cargarOrdenes();
    this.bindEventos();
    this.activarRealtime();
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
          num_orden, placa, prioridad, estado, motivo, creada_en, cerrada_en,
          vehiculos ( marca, modelo, anio ),
          servicios_orden ( id, estado, servicio_id, tecnico_id, hora_inicio )
        `)
        .in('estado', ['abierta', 'en_progreso', 'completada'])
        .order('creada_en', { ascending: false });
 
      if (error) throw error;
 
      const todas = data || [];
 
      // Para las completadas, verificar si la placa ya reportó movimiento GPS
      // después de la fecha de cierre de la orden.
      const completadas = todas.filter(o => o.estado === 'completada' && o.cerrada_en);
      if (completadas.length > 0) {
        await this.verificarMovimientoGps(completadas);
      }
 
      // Filtrar: quitar completadas cuya placa ya reportó movimiento GPS
      this.state.todasLasOrdenes = todas.filter(o => {
        if (o.estado !== 'completada') return true;  // activas siempre
        // Completada: mantener solo si la placa NO reportó movimiento post-cierre
        return !this.state.placasConMovimiento.has(o.placa);
      });
 
      this.aplicarFiltro();
      this.detectarServicioActivo();
    } catch (err) {
      Utils.log('Error cargando órdenes:', err);
    }
  },
 
  /**
   * Consulta gps_km para determinar qué placas de órdenes completadas
   * ya reportaron movimiento (≥ 2000 metros) en algún día posterior
   * al cierre de la orden. Esas placas ya se fueron del taller.
   */
  async verificarMovimientoGps(completadas) {
    try {
      // Encontrar la fecha de cierre más antigua para acotar la query
      const fechasCierre = completadas
        .map(o => o.cerrada_en?.slice(0, 10))
        .filter(Boolean)
        .sort();
      if (fechasCierre.length === 0) return;
      const fechaMinCierre = fechasCierre[0];
 
      // Placas únicas de las completadas
      const placas = [...new Set(completadas.map(o => o.placa))];
 
      // Traer registros GPS desde la fecha de cierre más antigua
      const { data, error } = await supabaseClient
        .from('gps_km')
        .select('placa, fecha, metros_registrado')
        .in('placa', placas)
        .gte('fecha', fechaMinCierre)
        .gte('metros_registrado', 2000);
 
      if (error) {
        Utils.log('verificarMovimientoGps: error (tolerado):', error.message);
        return;
      }
 
      // Construir set de placas que se movieron post-cierre
      const gpsData = data || [];
      const movimiento = new Set();
 
      for (const o of completadas) {
        if (movimiento.has(o.placa)) continue;
        const fechaCierre = o.cerrada_en?.slice(0, 10);
        if (!fechaCierre) continue;
 
        // ¿Tiene al menos un registro GPS con movimiento en fecha >= cierre?
        const seMovio = gpsData.some(g =>
          g.placa === o.placa && g.fecha >= fechaCierre
        );
        if (seMovio) movimiento.add(o.placa);
      }
 
      this.state.placasConMovimiento = movimiento;
      Utils.log(`GPS: ${movimiento.size} placas con movimiento post-cierre de ${placas.length} completadas`);
    } catch (err) {
      Utils.log('verificarMovimientoGps: error general (tolerado):', err);
    }
  },
 
  aplicarFiltro() {
    const q = this.state.busqueda.trim().toLowerCase();
 
    // Filtro por búsqueda (placa o número)
    this.state.ordenes = !q
      ? this.state.todasLasOrdenes
      : this.state.todasLasOrdenes.filter(o =>
          o.placa.toLowerCase().includes(q) ||
          o.num_orden.toLowerCase().includes(q)
        );
 
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
 
    // Ordenar por grupos de prioridad:
    //   0. MI orden activa (servicio en_progreso mío) — SIEMPRE primera
    //   1. Urgentes
    //   2. Mis órdenes pausadas
    //   3. Resto
    //   4. Completadas al final (aún en taller esperando GPS)
    // Dentro de cada grupo: por fecha de creación descendente.
    const userId = this.state.profile.id;
 
    const grupoOrden = (o) => {
      if (o.estado === 'completada') return 4;
      const servicios = o.servicios_orden || [];
      const miActiva = servicios.some(s => s.tecnico_id === userId && s.estado === 'en_progreso');
      if (miActiva) return 0;
      if (o.prioridad === 'urgente') return 1;
      const miPausada = servicios.some(s => s.tecnico_id === userId && s.estado === 'pausado');
      if (miPausada) return 2;
      return 3;
    };
 
    const ords = [...this.state.ordenes].sort((a, b) => {
      const ga = grupoOrden(a);
      const gb = grupoOrden(b);
      if (ga !== gb) return ga - gb;
      return new Date(b.creada_en) - new Date(a.creada_en);
    });
 
    count.textContent = ords.length;
 
    if (ords.length === 0) {
      let mensaje, sub = '';
      if (this.state.busqueda) {
        mensaje = 'No se encontraron vehículos con ese criterio.';
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
 
    const esCompletada = orden.estado === 'completada';
 
    let cardClass = 'vehiculo-card';
    if (esCompletada) cardClass += ' card-lista-entregar';  // reutilizamos el estilo visual
    if (orden.prioridad === 'urgente' && !esCompletada) cardClass += ' card-urgente';
    if (estadoMia) cardClass += ' card-mio';
    if (otroEnProgreso && !estadoMia) cardClass += ' card-otro';
 
    let badgeHtml;
    if (esCompletada) {
      badgeHtml = '<span class="badge-mini badge-lista-entregar">✓ COMPLETADA</span>';
    } else if (orden.prioridad === 'urgente') {
      badgeHtml = '<span class="badge-mini badge-urgente">Urgente</span>';
    } else {
      badgeHtml = '<span class="badge-mini badge-normal">Normal</span>';
    }
 
    const contadorHtml = total > 0
      ? `<span class="contador-completados">${completados}</span><span class="contador-sep">/</span><span class="contador-total">${total}</span>`
      : '';
 
    let statusHtml = '';
    if (esCompletada) {
      statusHtml = '<div class="card-status status-lista-entregar">✓ Trabajo terminado · Toca para agregar servicio</div>';
    } else if (estadoMia) {
      statusHtml = '<div class="card-status status-mio">▶ Tú estás trabajando aquí</div>';
    } else if (otroEnProgreso) {
      statusHtml = `<div class="card-status status-asignado">Otro técnico trabajando · ${contadorHtml}</div>`;
    } else if (algunaPendiente && completados === 0) {
      statusHtml = `<div class="card-status status-libre">Sin asignar · Disponible · ${contadorHtml} servicios</div>`;
    } else if (completados < total) {
      statusHtml = `<div class="card-status status-asignado">${contadorHtml} servicios</div>`;
    } else if (total > 0) {
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
 

