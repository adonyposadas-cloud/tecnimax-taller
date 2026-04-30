/**
 * historial.js — Pantalla de Historial de Órdenes
 *
 * Permite buscar órdenes por:
 *  - Placa
 *  - Número de orden
 *  - Técnico (nombre)
 *  - Servicio (nombre del catálogo)
 *
 * Filtros adicionales:
 *  - Período (últimos N días o todas)
 *  - Estado (completada, cancelada, en curso, abierta, todos)
 *
 * Cada orden se muestra como card colapsada. Al hacer click se expande
 * mostrando el detalle completo: cada servicio con su técnico, tiempos,
 * pausas, repuestos solicitados, observaciones y cancelaciones.
 *
 * Acceso: admin y jefe_pista.
 */

const Historial = {

  state: {
    profile: null,

    // Datos cargados (todo en memoria, filtrado en cliente)
    ordenes: [],          // de tabla 'ordenes' con join de vehiculos
    servicios: [],        // de tabla 'servicios_orden'
    usuarios: [],         // técnicos + admin + jefe
    serviciosCatalogo: [],
    pausas: [],
    cancelaciones: [],

    // Filtros activos
    tipoBusqueda: 'placa',  // 'placa' | 'orden' | 'tecnico' | 'servicio'
    busqueda: '',
    periodo: 'todas',       // 'todas' | '7' | '30' | '90' | '365'
    estado: 'todos',        // 'todos' | 'completada' | 'cancelada' | ...

    // UI
    ordenesExpandidas: new Set(),  // Set de num_orden
  },

  // ==================== INIT ====================
  async init() {
    Utils.log('Iniciando vista Historial...');

    const profile = await Auth.requireAuth();
    if (!profile) return;

    if (!['admin', 'jefe_pista'].includes(profile.rol)) {
      alert('No tienes permisos para ver el historial.');
      window.location.href = profile.rol === 'tecnico' ? 'tecnico.html' : 'admin.html';
      return;
    }

    this.state.profile = profile;
    document.getElementById('user-nombre-header').textContent = profile.nombre || 'Usuario';
    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

    // Si entra el jefe, redirigir el "Volver" a jefe.html en lugar de admin.html
    if (profile.rol === 'jefe_pista') {
      const btnVolver = document.getElementById('btn-volver');
      if (btnVolver) {
        btnVolver.href = 'jefe.html';
      }
    }

    this.bindEventos();
    await this.cargarTodo();
    this.aplicarFiltros();
  },

  // ==================== EVENTOS ====================
  bindEventos() {
    // Chips de tipo de búsqueda
    document.querySelectorAll('.hist-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tipo = chip.dataset.tipo;
        if (tipo === this.state.tipoBusqueda) return;

        document.querySelectorAll('.hist-chip').forEach(c => {
          c.classList.remove('hist-chip-active');
          c.setAttribute('aria-selected', 'false');
        });
        chip.classList.add('hist-chip-active');
        chip.setAttribute('aria-selected', 'true');
        this.state.tipoBusqueda = tipo;

        // Actualizar placeholder del input según el tipo
        const input = document.getElementById('hist-search-input');
        const placeholders = {
          placa: 'Ej: TAXI 7036',
          orden: 'Ej: OT-0008',
          tecnico: 'Ej: Anibal',
          servicio: 'Ej: Cambio de aceite',
        };
        input.placeholder = placeholders[tipo] || 'Buscar...';
        input.focus();

        this.aplicarFiltros();
      });
    });

    // Input de búsqueda con debounce
    const search = document.getElementById('hist-search-input');
    let debounceT;
    search.addEventListener('input', (e) => {
      clearTimeout(debounceT);
      debounceT = setTimeout(() => {
        this.state.busqueda = e.target.value;
        this.aplicarFiltros();
      }, 200);
    });

    // Selector de período
    document.getElementById('hist-fecha-select').addEventListener('change', (e) => {
      this.state.periodo = e.target.value;
      this.aplicarFiltros();
    });

    // Selector de estado
    document.getElementById('hist-estado-select').addEventListener('change', (e) => {
      this.state.estado = e.target.value;
      this.aplicarFiltros();
    });

    // Botón limpiar filtros
    document.getElementById('hist-btn-limpiar').addEventListener('click', () => {
      this.state.busqueda = '';
      this.state.periodo = 'todas';
      this.state.estado = 'todos';
      document.getElementById('hist-search-input').value = '';
      document.getElementById('hist-fecha-select').value = 'todas';
      document.getElementById('hist-estado-select').value = 'todos';
      this.aplicarFiltros();
    });
  },

  // ==================== CARGA DE DATOS ====================
  async cargarTodo() {
    document.getElementById('hist-loading').hidden = false;
    document.getElementById('hist-ordenes-list').hidden = true;
    document.getElementById('hist-empty').hidden = true;

    try {
      const [ordenesR, serviciosR, usuariosR, catalogoR, cancR, pausasR] = await Promise.all([
        // Órdenes con join al vehículo
        supabaseClient
          .from('ordenes')
          .select(`
            num_orden, placa, prioridad, estado, motivo, creada_en, cerrada_en,
            vehiculos ( marca, modelo, anio )
          `)
          .order('creada_en', { ascending: false }),

        // Todos los servicios de orden
        supabaseClient
          .from('servicios_orden')
          .select('id, num_orden, servicio_id, estado, tecnico_id, agregado_por, hora_inicio, hora_fin, tiempo_real_min, tiempo_asignado_min, sospechoso, observacion'),

        // Usuarios (técnicos, admin, jefe)
        supabaseClient
          .from('usuarios')
          .select('id, nombre, codigo, rol'),

        // Catálogo de servicios
        supabaseClient
          .from('catalogo_servicios')
          .select('id, nombre, categoria_id'),

        // Cancelaciones
        supabaseClient
          .from('cancelaciones_orden')
          .select('id, num_orden, motivo, cancelada_en, cancelada_por'),

        // Pausas (todas, las usaremos al expandir)
        supabaseClient
          .from('historial_pausas')
          .select('id, servicio_orden_id, tecnico_id, motivo, detalle_repuesto, hora_pausa, hora_reanudacion, pausado_por'),
      ]);

      if (ordenesR.error) throw ordenesR.error;
      if (serviciosR.error) throw serviciosR.error;
      if (usuariosR.error) throw usuariosR.error;
      if (catalogoR.error) throw catalogoR.error;
      // cancelaciones puede no existir en algunos casos, lo manejamos como vacío
      if (pausasR.error) throw pausasR.error;

      this.state.ordenes = ordenesR.data || [];
      this.state.servicios = serviciosR.data || [];
      this.state.usuarios = usuariosR.data || [];
      this.state.serviciosCatalogo = catalogoR.data || [];
      this.state.cancelaciones = (cancR && !cancR.error) ? (cancR.data || []) : [];
      this.state.pausas = pausasR.data || [];

      Utils.log(`Historial cargado: ${this.state.ordenes.length} órdenes, ${this.state.servicios.length} servicios, ${this.state.pausas.length} pausas.`);
    } catch (err) {
      Utils.log('Error cargando historial:', err);
      document.getElementById('hist-loading').innerHTML = `<p style="color: var(--rojo-urgente);">Error cargando datos: ${Utils.escapeHtml(err.message || '')}</p>`;
      return;
    } finally {
      document.getElementById('hist-loading').hidden = true;
    }
  },

  // ==================== FILTRADO ====================
  aplicarFiltros() {
    const q = this.state.busqueda.trim().toLowerCase();
    const tipo = this.state.tipoBusqueda;
    const periodo = this.state.periodo;
    const estadoFilter = this.state.estado;

    // Calcular fecha límite si hay período
    let fechaDesde = null;
    if (periodo !== 'todas') {
      const dias = parseInt(periodo, 10);
      if (!isNaN(dias)) {
        fechaDesde = new Date();
        fechaDesde.setDate(fechaDesde.getDate() - dias);
        fechaDesde.setHours(0, 0, 0, 0);
      }
    }

    // 1. Filtrar por período
    let resultado = this.state.ordenes.filter(o => {
      if (!fechaDesde) return true;
      const f = new Date(o.creada_en);
      return f >= fechaDesde;
    });

    // 2. Filtrar por estado
    if (estadoFilter !== 'todos') {
      resultado = resultado.filter(o => o.estado === estadoFilter);
    }

    // 3. Filtrar por búsqueda según tipo
    if (q) {
      resultado = resultado.filter(o => this.coincideOrden(o, tipo, q));
    }

    // Render
    this.renderResultados(resultado);
  },

  coincideOrden(orden, tipo, q) {
    if (tipo === 'placa') {
      return (orden.placa || '').toLowerCase().includes(q);
    }
    if (tipo === 'orden') {
      return (orden.num_orden || '').toLowerCase().includes(q);
    }
    if (tipo === 'tecnico') {
      // Buscar en los servicios de esta orden si algún técnico coincide por nombre o código
      const serviciosOrden = this.state.servicios.filter(s => s.num_orden === orden.num_orden);
      return serviciosOrden.some(s => {
        const u = this.state.usuarios.find(x => x.id === s.tecnico_id);
        if (!u) return false;
        const nombre = (u.nombre || '').toLowerCase();
        const codigo = (u.codigo || '').toLowerCase();
        return nombre.includes(q) || codigo.includes(q);
      });
    }
    if (tipo === 'servicio') {
      // Buscar en los servicios de esta orden si algún catálogo coincide
      const serviciosOrden = this.state.servicios.filter(s => s.num_orden === orden.num_orden);
      return serviciosOrden.some(s => {
        const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
        if (!cat) return false;
        return (cat.nombre || '').toLowerCase().includes(q);
      });
    }
    return true;
  },

  // ==================== RENDER ====================
  renderResultados(ordenes) {
    const list = document.getElementById('hist-ordenes-list');
    const empty = document.getElementById('hist-empty');
    const count = document.getElementById('hist-resultados-count');

    count.textContent = ordenes.length;

    if (ordenes.length === 0) {
      list.hidden = true;
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    list.hidden = false;

    list.innerHTML = ordenes.map(o => this.renderCardOrden(o)).join('');

    // Bind clicks en cada header de card
    list.querySelectorAll('.hist-orden-header').forEach(header => {
      header.addEventListener('click', () => {
        const num = header.closest('.hist-orden-card').dataset.numOrden;
        this.toggleOrden(num);
      });
    });
  },

  renderCardOrden(orden) {
    const num = orden.num_orden;
    const expandida = this.state.ordenesExpandidas.has(num);

    const v = orden.vehiculos || {};
    const vehiculoTxt = `${v.marca || ''} ${v.modelo || ''}${v.anio ? ' ' + v.anio : ''}`.trim() || '—';

    const serviciosOrden = this.state.servicios.filter(s => s.num_orden === num);
    const totalServicios = serviciosOrden.length;
    const completados = serviciosOrden.filter(s => s.estado === 'completado').length;
    const cancelados = serviciosOrden.filter(s => s.estado === 'cancelado').length;

    // Tiempo total trabajado en esta orden (suma de tiempo_real_min)
    const tiempoTotalMin = serviciosOrden
      .filter(s => s.estado === 'completado' && s.tiempo_real_min)
      .reduce((acc, s) => acc + s.tiempo_real_min, 0);

    // Técnicos únicos que participaron
    const tecnicosIds = new Set(serviciosOrden.map(s => s.tecnico_id).filter(Boolean));
    const tecnicosNombres = [...tecnicosIds]
      .map(id => {
        const u = this.state.usuarios.find(x => x.id === id);
        return u ? u.nombre : null;
      })
      .filter(Boolean);

    const fechaFmt = this.formatFecha(orden.creada_en);
    const estadoTexto = this.estadoLegible(orden.estado);
    const estadoClass = `hist-estado-${orden.estado || 'abierta'}`;

    // Lista de nombres de servicios (preview)
    const nombresServ = serviciosOrden
      .map(s => {
        const c = this.state.serviciosCatalogo.find(x => x.id === s.servicio_id);
        return c?.nombre;
      })
      .filter(Boolean);
    const previewServ = nombresServ.slice(0, 3).join(' · ') + (nombresServ.length > 3 ? ` · +${nombresServ.length - 3} más` : '');

    let html = `
      <div class="hist-orden-card${expandida ? ' expandida' : ''}" data-num-orden="${Utils.escapeHtml(num)}">
        <div class="hist-orden-header" role="button" tabindex="0" aria-expanded="${expandida}">
          <div>
            <div class="hist-orden-titulo-row">
              <span class="hist-orden-num">${Utils.escapeHtml(num)}</span>
              <span class="hist-orden-placa">${Utils.escapeHtml(orden.placa || '—')}</span>
              <span class="hist-estado-badge ${estadoClass}">${estadoTexto}</span>
              ${orden.prioridad === 'urgente' ? '<span class="hist-estado-badge hist-estado-cancelada">Urgente</span>' : ''}
            </div>
            <div class="hist-orden-vehiculo" style="margin-top: 4px;">${Utils.escapeHtml(vehiculoTxt)}${previewServ ? ' · ' + Utils.escapeHtml(previewServ) : ''}</div>
            <div class="hist-orden-meta">
              <span>📅 <strong>${fechaFmt}</strong></span>
              <span>👤 <strong>${tecnicosNombres.length > 0 ? Utils.escapeHtml(tecnicosNombres.join(', ')) : 'Sin asignar'}</strong></span>
              ${totalServicios > 0 ? `<span>🔧 <strong>${completados}/${totalServicios}</strong> servicios</span>` : ''}
              ${tiempoTotalMin > 0 ? `<span>⏱ <strong>${this.formatMin(tiempoTotalMin)}</strong></span>` : ''}
            </div>
          </div>
          <span class="hist-orden-toggle" aria-hidden="true">▼</span>
        </div>
        ${expandida ? this.renderDetalleOrden(orden, serviciosOrden) : ''}
      </div>
    `;

    return html;
  },

  renderDetalleOrden(orden, serviciosOrden) {
    const num = orden.num_orden;

    // Resumen totales
    const tiempoTotalMin = serviciosOrden
      .filter(s => s.estado === 'completado' && s.tiempo_real_min)
      .reduce((acc, s) => acc + s.tiempo_real_min, 0);
    const totalPausasMin = this.state.pausas
      .filter(p => {
        if (!p.hora_pausa || !p.hora_reanudacion) return false;
        return serviciosOrden.some(s => s.id === p.servicio_orden_id);
      })
      .reduce((acc, p) => acc + Math.round((new Date(p.hora_reanudacion) - new Date(p.hora_pausa)) / 60000), 0);

    let resumenHtml = `
      <div class="hist-orden-resumen-totales">
        <div class="hist-resumen-item">
          <span class="hist-resumen-label">Tiempo trabajado</span>
          <span class="hist-resumen-value">${this.formatMin(tiempoTotalMin) || '—'}</span>
        </div>
        <div class="hist-resumen-item">
          <span class="hist-resumen-label">Tiempo en pausa</span>
          <span class="hist-resumen-value">${this.formatMin(totalPausasMin) || '—'}</span>
        </div>
        <div class="hist-resumen-item">
          <span class="hist-resumen-label">Servicios</span>
          <span class="hist-resumen-value">${serviciosOrden.length}</span>
        </div>
        ${orden.cerrada_en ? `
        <div class="hist-resumen-item">
          <span class="hist-resumen-label">Cerrada</span>
          <span class="hist-resumen-value">${this.formatFecha(orden.cerrada_en)}</span>
        </div>` : ''}
      </div>
    `;

    // Motivo de la orden si tiene
    let motivoHtml = '';
    if (orden.motivo) {
      motivoHtml = `
        <div class="hist-detalle-section">
          <div class="hist-detalle-titulo">Motivo de ingreso</div>
          <div style="padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px; font-size: 0.88rem; color: var(--text);">
            ${Utils.escapeHtml(orden.motivo)}
          </div>
        </div>
      `;
    }

    // Servicios
    let serviciosHtml = '';
    if (serviciosOrden.length > 0) {
      serviciosHtml = `
        <div class="hist-detalle-section">
          <div class="hist-detalle-titulo">Servicios</div>
          ${serviciosOrden.map(s => this.renderServicioRow(s)).join('')}
        </div>
      `;
    }

    // Pausas asociadas a esta orden
    const pausasOrden = this.state.pausas.filter(p =>
      serviciosOrden.some(s => s.id === p.servicio_orden_id)
    );
    let pausasHtml = '';
    if (pausasOrden.length > 0) {
      pausasHtml = `
        <div class="hist-detalle-section">
          <div class="hist-detalle-titulo">Pausas registradas (${pausasOrden.length})</div>
          ${pausasOrden.map(p => this.renderPausaRow(p, serviciosOrden)).join('')}
        </div>
      `;
    }

    // Cancelación de la orden completa
    const cancelacionOrden = this.state.cancelaciones.find(c => c.num_orden === num);
    let cancelacionHtml = '';
    if (cancelacionOrden) {
      const canceladaPor = this.nombreUsuario(cancelacionOrden.cancelada_por);
      cancelacionHtml = `
        <div class="hist-detalle-section">
          <div class="hist-detalle-titulo">Cancelación</div>
          <div class="hist-cancelacion-row">
            <div class="hist-cancelacion-motivo">"${Utils.escapeHtml(cancelacionOrden.motivo || '—')}"</div>
            <div class="hist-cancelacion-meta">
              ${this.formatFecha(cancelacionOrden.cancelada_en)} · Por ${Utils.escapeHtml(canceladaPor)}
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="hist-orden-detalle">
        ${resumenHtml}
        ${motivoHtml}
        ${serviciosHtml}
        ${pausasHtml}
        ${cancelacionHtml}
      </div>
    `;
  },

  renderServicioRow(s) {
    const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
    const nombre = cat?.nombre || 'Servicio';

    const tecnico = this.nombreUsuario(s.tecnico_id);
    const agregadoPor = s.agregado_por ? this.nombreUsuario(s.agregado_por) : null;

    const inicio = s.hora_inicio ? this.formatHoraCompleta(s.hora_inicio) : null;
    const fin = s.hora_fin ? this.formatHoraCompleta(s.hora_fin) : null;

    let tiempoTexto = '';
    if (s.estado === 'completado' && s.tiempo_real_min) {
      tiempoTexto = this.formatMin(s.tiempo_real_min);
    } else if (s.estado === 'pausado') {
      tiempoTexto = '⏸ Pausado';
    } else if (s.estado === 'en_progreso') {
      tiempoTexto = '▶ En curso';
    } else if (s.estado === 'pendiente') {
      tiempoTexto = 'Pendiente';
    } else if (s.estado === 'cancelado') {
      tiempoTexto = '✕ Cancelado';
    }

    const tiempoEsperado = cat?.tiempo_promedio_min;
    const sospechoso = s.sospechoso === true;

    const cancelado = s.estado === 'cancelado';

    return `
      <div class="hist-servicio-row${cancelado ? ' hist-servicio-cancelado' : ''}">
        <div class="hist-servicio-info">
          <div class="hist-servicio-nombre">${Utils.escapeHtml(nombre)}</div>
          ${tecnico !== '—' ? `<div class="hist-servicio-tecnico">Técnico: <strong>${Utils.escapeHtml(tecnico)}</strong>${agregadoPor && agregadoPor !== '—' ? ` · agregado por ${Utils.escapeHtml(agregadoPor)}` : ''}</div>` : ''}
          ${inicio || fin ? `<div class="hist-servicio-tiempos">${inicio ? '▶ ' + inicio : ''}${fin ? ' → ⏹ ' + fin : ''}</div>` : ''}
          ${sospechoso ? `<div class="hist-servicio-sospechoso">⚠ Tiempo sospechoso${tiempoEsperado ? ` (esperado ~${tiempoEsperado} min)` : ''}</div>` : ''}
          ${s.observacion ? `<div class="hist-servicio-obs">"${Utils.escapeHtml(s.observacion)}"</div>` : ''}
        </div>
        <div class="hist-servicio-tiempo-real">${tiempoTexto}</div>
      </div>
    `;
  },

  renderPausaRow(p, serviciosOrden) {
    const servicio = serviciosOrden.find(s => s.id === p.servicio_orden_id);
    const cat = servicio ? this.state.serviciosCatalogo.find(c => c.id === servicio.servicio_id) : null;
    const nombreServ = cat?.nombre || 'Servicio';

    const tecnico = this.nombreUsuario(p.tecnico_id);
    const motivoFmt = (p.motivo || '').replace(/_/g, ' ');

    let duracionMs = null;
    if (p.hora_pausa && p.hora_reanudacion) {
      duracionMs = new Date(p.hora_reanudacion) - new Date(p.hora_pausa);
    }
    const duracionFmt = duracionMs !== null ? this.formatMin(Math.round(duracionMs / 60000)) : 'En curso';

    const horaPausa = this.formatHoraCompleta(p.hora_pausa);
    const horaReanudacion = p.hora_reanudacion ? this.formatHoraCompleta(p.hora_reanudacion) : null;

    let detalleExtra = '';
    if (p.detalle_repuesto) {
      detalleExtra = ` · "${p.detalle_repuesto}"`;
    }
    const pausadoPor = p.pausado_por ? this.nombreUsuario(p.pausado_por) : null;
    const pausadoPorTxt = pausadoPor && pausadoPor !== '—' && pausadoPor !== tecnico
      ? ` · pausado por ${pausadoPor}`
      : '';

    return `
      <div class="hist-pausa-row">
        <div>
          <div class="hist-pausa-motivo">⏸ ${Utils.escapeHtml(motivoFmt)}${detalleExtra ? ' ' + Utils.escapeHtml(detalleExtra) : ''}</div>
          <div class="hist-pausa-detalle">${Utils.escapeHtml(nombreServ)} · ${Utils.escapeHtml(tecnico)}${Utils.escapeHtml(pausadoPorTxt)}</div>
        </div>
        <div class="hist-pausa-tiempo">
          <div>${duracionFmt}</div>
          <div style="font-size: 0.7rem; opacity: 0.7;">${horaPausa}${horaReanudacion ? ' → ' + horaReanudacion : ''}</div>
        </div>
      </div>
    `;
  },

  // ==================== EXPAND / COLLAPSE ====================
  toggleOrden(numOrden) {
    if (this.state.ordenesExpandidas.has(numOrden)) {
      this.state.ordenesExpandidas.delete(numOrden);
    } else {
      this.state.ordenesExpandidas.add(numOrden);
    }
    this.aplicarFiltros();  // re-render
  },

  // ==================== HELPERS ====================
  nombreUsuario(uid) {
    if (!uid) return '—';
    const u = this.state.usuarios.find(x => x.id === uid);
    return u ? u.nombre : '—';
  },

  estadoLegible(estado) {
    const map = {
      'completada': 'Completada',
      'cancelada': 'Cancelada',
      'en_progreso': 'En curso',
      'abierta': 'Abierta',
      'pausada': 'Pausada',
    };
    return map[estado] || (estado || '—');
  },

  formatMin(min) {
    if (!min || min === 0) return '0 min';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  },

  formatFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yy} ${hh}:${mi}`;
  },

  formatHoraCompleta(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${mi}`;
  },
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    console.error('Supabase no inicializado');
    return;
  }
  Historial.init();
});
