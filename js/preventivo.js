/**
 * preventivo.js — Mantenimiento Preventivo · TECNIMAX Taller
 *
 * Muestra, por cada unidad de la flota, todos los servicios que se le han
 * realizado, la última vez que se hizo cada uno y los km acumulados desde
 * entonces (calculados con los registros de gps_km).
 *
 * Acceso: admin y jefe_pista.
 */

const Preventivo = {

  state: {
    profile: null,
    ordenes: [],        // con join vehiculos
    servicios: [],      // servicios_orden completados (solo los que tienen hora_fin)
    catalogo: [],       // catalogo_servicios
    gpsKm: [],          // gps_km completo
    filtroPlaca: '',
    soloConGps: false,
    resumenFlota: [],   // construido en construirResumen()
    expandidas: new Set(),
  },

  // ==================== INIT ====================
  async init() {
    Utils.log('Iniciando vista Preventivo...');

    const profile = await Auth.requireAuth();
    if (!profile) return;

    if (!['admin', 'jefe_pista'].includes(profile.rol)) {
      alert('No tienes permisos para ver esta sección.');
      window.location.href = profile.rol === 'tecnico' ? 'tecnico.html' : 'admin.html';
      return;
    }

    this.state.profile = profile;
    document.getElementById('user-nombre-header').textContent = profile.nombre || 'Usuario';
    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

    if (profile.rol === 'jefe_pista') {
      const btnVolver = document.getElementById('btn-volver');
      if (btnVolver) btnVolver.href = 'jefe.html';
    }

    this.bindEventos();
    await this.cargarTodo();
    this.construirResumen();
    this.render();
  },

  // ==================== EVENTOS ====================
  bindEventos() {
    const inputPlaca = document.getElementById('prev-input-placa');
    if (inputPlaca) {
      let debounce;
      inputPlaca.addEventListener('input', (e) => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          this.state.filtroPlaca = e.target.value.trim().toLowerCase();
          this.render();
        }, 200);
      });
    }

    const toggleGps = document.getElementById('prev-toggle-gps');
    if (toggleGps) {
      toggleGps.addEventListener('change', (e) => {
        this.state.soloConGps = e.target.checked;
        this.render();
      });
    }
  },

  // ==================== CARGA ====================
  async cargarTodo() {
    const loading = document.getElementById('prev-loading');
    const main = document.getElementById('prev-main');
    if (loading) loading.hidden = false;
    if (main) main.hidden = true;

    // Timeout de diagnóstico: si en 12s no cargó, muestra qué falló
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      if (loading && !loading.hidden) {
        loading.innerHTML = `
          <p style="color:#ffc107;text-align:center;font-size:0.9rem;">
            ⏱ La carga está tardando más de lo esperado.<br>
            Revisa la consola del navegador (F12 → Console) para ver el error.
          </p>`;
      }
    }, 12000);

    try {
      const [ordenesR, serviciosR, catalogoR, gpsR] = await Promise.all([
        supabaseClient
          .from('ordenes')
          .select('num_orden, placa, vehiculos(marca, modelo, anio)'),

        // Sin .not() para evitar combinaciones problemáticas con Supabase;
        // filtramos hora_fin null en el cliente
        supabaseClient
          .from('servicios_orden')
          .select('id, num_orden, servicio_id, estado, hora_fin, tecnico_id')
          .eq('estado', 'completado'),

        supabaseClient
          .from('catalogo_servicios')
          .select('id, nombre'),

        supabaseClient
          .from('gps_km')
          .select('placa, fecha, metros_registrado'),
      ]);

      clearTimeout(timeoutId);
      if (timedOut) return; // si ya se mostró el error, no continuar

      if (ordenesR.error)  throw new Error(`ordenes: ${ordenesR.error.message}`);
      if (serviciosR.error) throw new Error(`servicios_orden: ${serviciosR.error.message}`);
      if (catalogoR.error) throw new Error(`catalogo_servicios: ${catalogoR.error.message}`);
      if (gpsR.error)      throw new Error(`gps_km: ${gpsR.error.message}`);

      this.state.ordenes   = ordenesR.data || [];
      // Filtro client-side: solo los que tienen hora_fin registrada
      this.state.servicios = (serviciosR.data || []).filter(s => s.hora_fin != null);
      this.state.catalogo  = catalogoR.data || [];
      this.state.gpsKm     = gpsR.data      || [];

      Utils.log(`Preventivo: ${this.state.ordenes.length} órdenes, ${this.state.servicios.length} servicios completados, ${this.state.gpsKm.length} registros GPS.`);

    } catch (err) {
      clearTimeout(timeoutId);
      Utils.log('Error cargando preventivo:', err);
      if (loading) {
        loading.innerHTML = `
          <p style="color:#f87171;text-align:center;padding:20px;font-size:0.88rem;">
            ❌ Error cargando datos:<br><strong>${Utils.escapeHtml(err.message || String(err))}</strong>
          </p>`;
        loading.hidden = false;
        if (main) main.hidden = true;
        return;
      }
    } finally {
      clearTimeout(timeoutId);
      if (!timedOut) {
        if (loading) loading.hidden = true;
        if (main) main.hidden = false;
      }
    }
  },

  // ==================== CONSTRUCCIÓN DEL RESUMEN ====================
  /**
   * Por cada placa, construye la lista de servicios que se le han hecho:
   * - última fecha de realización
   * - km acumulados desde esa fecha hasta hoy
   * - cuántas veces se realizó en total
   *
   * Resultado ordenado: vehículos con mayor km en su servicio más antiguo
   * aparecen primero (los que más necesitan atención).
   */
  construirResumen() {
    // Mapa rápido: num_orden → orden
    const ordenPorNum = new Map(this.state.ordenes.map(o => [o.num_orden, o]));

    // Mapa: placa → Map<servicio_id, { ultimaFecha, count }>
    const placaServicios = new Map();

    this.state.servicios.forEach(s => {
      const orden = ordenPorNum.get(s.num_orden);
      if (!orden) return;
      const placa = orden.placa;
      if (!placa) return;

      if (!placaServicios.has(placa)) placaServicios.set(placa, new Map());
      const mapa = placaServicios.get(placa);

      const prev = mapa.get(s.servicio_id);
      const esNuevo = !prev || s.hora_fin > prev.ultimaFecha;

      mapa.set(s.servicio_id, {
        ultimaFecha: esNuevo ? s.hora_fin : prev.ultimaFecha,
        count: (prev?.count || 0) + 1,
      });
    });

    // Construir array de vehículos
    const resumen = [];

    placaServicios.forEach((mapaServicios, placa) => {
      const orden = this.state.ordenes.find(o => o.placa === placa);
      const v = orden?.vehiculos || {};
      const vehiculoTxt = [v.marca, v.modelo, v.anio ? String(v.anio) : null]
        .filter(Boolean).join(' ') || '—';

      const tieneGps = this.state.gpsKm.some(g => g.placa === placa);

      const serviciosArr = [];
      mapaServicios.forEach((data, servicio_id) => {
        const cat = this.state.catalogo.find(c => String(c.id) === String(servicio_id));
        const kmDesde = tieneGps ? this.calcularKmDesde(placa, data.ultimaFecha) : null;
        serviciosArr.push({
          id: servicio_id,
          nombre: cat?.nombre || '(servicio eliminado)',
          ultimaFecha: data.ultimaFecha,
          kmDesde,
          vecesRealizado: data.count,
        });
      });

      // Ordenar servicios: mayor km primero (sin GPS al final)
      serviciosArr.sort((a, b) => {
        if (a.kmDesde === null && b.kmDesde === null) return 0;
        if (a.kmDesde === null) return 1;
        if (b.kmDesde === null) return -1;
        return b.kmDesde - a.kmDesde;
      });

      resumen.push({ placa, vehiculoTxt, tieneGps, servicios: serviciosArr });
    });

    // Ordenar flota: mayor km de su servicio más antiguo primero
    resumen.sort((a, b) => {
      const maxA = a.servicios.find(s => s.kmDesde !== null)?.kmDesde ?? -1;
      const maxB = b.servicios.find(s => s.kmDesde !== null)?.kmDesde ?? -1;
      return maxB - maxA;
    });

    this.state.resumenFlota = resumen;
    this.actualizarStats();
  },

  actualizarStats() {
    const totalVehiculos = document.getElementById('prev-stat-vehiculos');
    const totalServicios = document.getElementById('prev-stat-servicios');
    if (totalVehiculos) totalVehiculos.textContent = this.state.resumenFlota.length;
    if (totalServicios) {
      const tot = this.state.resumenFlota.reduce((s, v) => s + v.servicios.length, 0);
      totalServicios.textContent = tot;
    }
  },

  // ==================== RENDER ====================
  render() {
    const container = document.getElementById('prev-flota-list');
    if (!container) return;

    const filtro = this.state.filtroPlaca;
    let flota = this.state.resumenFlota;

    if (filtro) {
      flota = flota.filter(v => v.placa.toLowerCase().includes(filtro));
    }
    if (this.state.soloConGps) {
      flota = flota.filter(v => v.tieneGps);
    }

    const empty = document.getElementById('prev-empty');
    if (flota.length === 0) {
      container.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    container.innerHTML = flota.map(v => this.renderVehiculoCard(v)).join('');

    // Bind expand/collapse
    container.querySelectorAll('.prev-vehiculo-header').forEach(header => {
      header.addEventListener('click', () => {
        const placa = header.closest('.prev-vehiculo-card').dataset.placa;
        if (this.state.expandidas.has(placa)) {
          this.state.expandidas.delete(placa);
        } else {
          this.state.expandidas.add(placa);
        }
        this.render();
      });
    });
  },

  renderVehiculoCard(v) {
    const expandida = this.state.expandidas.has(v.placa);

    // Primer servicio con km (el de mayor km) para mostrarlo en el header
    const servicioDestacado = v.servicios.find(s => s.kmDesde !== null && s.kmDesde > 0);
    const kmMax = servicioDestacado?.kmDesde ?? null;

    let kmHeaderBadge = '';
    if (!v.tieneGps) {
      kmHeaderBadge = '<span class="prev-badge prev-badge-nogps">Sin GPS</span>';
    } else if (kmMax !== null) {
      kmHeaderBadge = `<span class="prev-badge prev-badge-km">📍 ${this.formatKm(kmMax)} en ${Utils.escapeHtml(servicioDestacado.nombre)}</span>`;
    }

    const serviciosHtml = expandida ? `
      <div class="prev-servicios-tabla">
        <div class="prev-servicios-header-row">
          <span>Servicio</span>
          <span>Última vez</span>
          <span>Km desde entonces</span>
          <span>Realizaciones</span>
        </div>
        ${v.servicios.map(s => this.renderServicioFila(s, v.tieneGps)).join('')}
      </div>` : '';

    return `
      <div class="prev-vehiculo-card${expandida ? ' expandida' : ''}" data-placa="${Utils.escapeHtml(v.placa)}">
        <div class="prev-vehiculo-header" role="button" tabindex="0">
          <div class="prev-vehiculo-info">
            <span class="prev-placa">${Utils.escapeHtml(v.placa)}</span>
            <span class="prev-vehiculo-txt">${Utils.escapeHtml(v.vehiculoTxt)}</span>
            ${kmHeaderBadge}
          </div>
          <div class="prev-vehiculo-right">
            <span class="prev-servicios-count">${v.servicios.length} tipo${v.servicios.length !== 1 ? 's' : ''} de servicio</span>
            <span class="prev-toggle-icon">${expandida ? '▲' : '▼'}</span>
          </div>
        </div>
        ${serviciosHtml}
      </div>
    `;
  },

  renderServicioFila(s, tieneGps) {
    const fecha = s.ultimaFecha ? this.formatFecha(s.ultimaFecha) : '—';

    let kmTxt = '—';
    let kmClass = '';
    if (!tieneGps) {
      kmTxt = '<span class="prev-sin-gps-txt">Sin datos GPS</span>';
    } else if (s.kmDesde !== null) {
      kmTxt = this.formatKm(s.kmDesde);
      // Colorear de mayor a menor urgencia (orientativo — sin umbrales fijos)
      if (s.kmDesde >= 10000) kmClass = 'prev-km-alto';
      else if (s.kmDesde >= 5000) kmClass = 'prev-km-medio';
      else kmClass = 'prev-km-bajo';
    }

    return `
      <div class="prev-servicio-fila">
        <span class="prev-servicio-nombre">${Utils.escapeHtml(s.nombre)}</span>
        <span class="prev-servicio-fecha">${fecha}</span>
        <span class="prev-servicio-km ${kmClass}">${kmTxt}</span>
        <span class="prev-servicio-veces">${s.vecesRealizado}×</span>
      </div>
    `;
  },

  // ==================== GPS KM (mismo helper que historial.js) ====================
  calcularKmDesde(placa, fechaISO) {
    if (!placa || !fechaISO) return null;
    const fechaLimite = fechaISO.substring(0, 10);
    const metros = (this.state.gpsKm || [])
      .filter(g =>
        g.placa === placa &&
        g.fecha > fechaLimite &&
        g.metros_registrado !== 1001
      )
      .reduce((sum, g) => sum + (g.metros_registrado || 0), 0);
    return Math.round(metros / 100) / 10;
  },

  formatKm(km) {
    if (km === null || km === undefined) return '—';
    if (km < 1) return '< 1 km';
    return km.toLocaleString('es-HN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
  },

  formatFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    return `${dd}/${mm}/${yy}`;
  },
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    console.error('Supabase no inicializado');
    return;
  }
  Preventivo.init();
});
