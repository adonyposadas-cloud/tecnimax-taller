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

    // Filtros activos — TODOS combinables, AND lógico entre ellos
    filtros: {
      placa: '',          // texto libre
      orden: '',          // texto libre
      tecnico: null,      // id (uuid) o null
      tecnicoLabel: '',   // nombre visible
      servicio: null,     // id (uuid) o null
      servicioLabel: '',  // nombre visible
    },
    periodo: 'todas',       // 'todas' | '7' | '30' | '90' | '365'
    estado: 'todos',        // 'todos' | 'completada' | 'cancelada' | ...

    // UI
    ordenesExpandidas: new Set(),  // Set de num_orden
    // Estado de cada combobox abierto: { tecnico: 'texto', servicio: 'texto' }
    comboFiltros: { tecnico: '', servicio: '' },
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
    // ===== Inputs de texto: placa y orden =====
    const inputPlaca = document.getElementById('hist-input-placa');
    const inputOrden = document.getElementById('hist-input-orden');

    let debouncePlaca, debounceOrden;
    inputPlaca.addEventListener('input', (e) => {
      clearTimeout(debouncePlaca);
      debouncePlaca = setTimeout(() => {
        this.state.filtros.placa = e.target.value;
        this.actualizarBotonesClear();
        this.aplicarFiltros();
      }, 200);
    });
    inputOrden.addEventListener('input', (e) => {
      clearTimeout(debounceOrden);
      debounceOrden = setTimeout(() => {
        this.state.filtros.orden = e.target.value;
        this.actualizarBotonesClear();
        this.aplicarFiltros();
      }, 200);
    });

    // Botón ✕ de cada input
    document.querySelectorAll('.hist-input-clear').forEach(btn => {
      btn.addEventListener('click', () => {
        const tipo = btn.dataset.clear;
        this.state.filtros[tipo] = '';
        if (tipo === 'placa') inputPlaca.value = '';
        if (tipo === 'orden') inputOrden.value = '';
        this.actualizarBotonesClear();
        this.aplicarFiltros();
      });
    });

    // ===== Comboboxes (técnico, servicio) =====
    document.querySelectorAll('.hist-combobox').forEach(combo => {
      const tipo = combo.dataset.combo; // 'tecnico' | 'servicio'
      const trigger = combo.querySelector('.hist-combo-trigger');
      const panel = combo.querySelector('.hist-combo-panel');
      const search = combo.querySelector('.hist-combo-search');
      const list = combo.querySelector('.hist-combo-list');
      const clearBtn = combo.querySelector('.hist-combo-clear');

      trigger.addEventListener('click', (e) => {
        if (e.target === clearBtn) return;
        this.toggleCombobox(combo);
      });
      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toggleCombobox(combo);
        }
      });

      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.state.filtros[tipo] = null;
        this.state.filtros[tipo + 'Label'] = '';
        this.actualizarComboTrigger(combo);
        this.aplicarFiltros();
      });

      search.addEventListener('input', (e) => {
        this.state.comboFiltros[tipo] = e.target.value;
        this.renderComboItems(combo);
      });
    });

    // Cerrar comboboxes al click fuera
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.hist-combobox').forEach(combo => {
        if (!combo.contains(e.target)) {
          this.cerrarCombobox(combo);
        }
      });
    });

    // ===== Selectores de período/estado =====
    document.getElementById('hist-fecha-select').addEventListener('change', (e) => {
      this.state.periodo = e.target.value;
      this.aplicarFiltros();
    });

    document.getElementById('hist-estado-select').addEventListener('change', (e) => {
      this.state.estado = e.target.value;
      this.aplicarFiltros();
    });

    // ===== Botón limpiar TODO =====
    document.getElementById('hist-btn-limpiar').addEventListener('click', () => {
      this.state.filtros = {
        placa: '', orden: '',
        tecnico: null, tecnicoLabel: '',
        servicio: null, servicioLabel: '',
      };
      this.state.periodo = 'todas';
      this.state.estado = 'todos';
      inputPlaca.value = '';
      inputOrden.value = '';
      document.getElementById('hist-fecha-select').value = 'todas';
      document.getElementById('hist-estado-select').value = 'todos';
      // Limpiar UI de comboboxes
      document.querySelectorAll('.hist-combobox').forEach(c => this.actualizarComboTrigger(c));
      this.actualizarBotonesClear();
      this.aplicarFiltros();
    });
  },

  // Mostrar / ocultar la X de cada input
  actualizarBotonesClear() {
    document.querySelectorAll('.hist-input-clear').forEach(btn => {
      const tipo = btn.dataset.clear;
      btn.hidden = !this.state.filtros[tipo];
    });
  },

  // Refresca el texto y la X del trigger de un combobox según selección actual
  actualizarComboTrigger(combo) {
    const tipo = combo.dataset.combo;
    const text = combo.querySelector('.hist-combo-text');
    const clearBtn = combo.querySelector('.hist-combo-clear');
    const id = this.state.filtros[tipo];
    const label = this.state.filtros[tipo + 'Label'];
    if (id) {
      text.textContent = label || '—';
      text.classList.remove('is-placeholder');
      clearBtn.hidden = false;
    } else {
      text.textContent = 'Cualquiera';
      text.classList.add('is-placeholder');
      clearBtn.hidden = true;
    }
  },

  toggleCombobox(combo) {
    const panel = combo.querySelector('.hist-combo-panel');
    const trigger = combo.querySelector('.hist-combo-trigger');
    const search = combo.querySelector('.hist-combo-search');
    const tipo = combo.dataset.combo;
    const isOpen = !panel.hidden;

    if (isOpen) {
      this.cerrarCombobox(combo);
    } else {
      // Cerrar otros comboboxes antes de abrir éste
      document.querySelectorAll('.hist-combobox').forEach(c => {
        if (c !== combo) this.cerrarCombobox(c);
      });
      panel.hidden = false;
      trigger.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      this.state.comboFiltros[tipo] = '';
      search.value = '';
      this.renderComboItems(combo);
      setTimeout(() => search.focus(), 30);
    }
  },

  cerrarCombobox(combo) {
    const panel = combo.querySelector('.hist-combo-panel');
    const trigger = combo.querySelector('.hist-combo-trigger');
    if (!panel) return;
    panel.hidden = true;
    trigger.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
  },

  renderComboItems(combo) {
    const tipo = combo.dataset.combo;
    const list = combo.querySelector('.hist-combo-list');
    const filtroTexto = (this.state.comboFiltros[tipo] || '').toLowerCase().trim();

    let items = [];
    if (tipo === 'tecnico') {
      items = (this.state.usuarios || [])
        .filter(u => u.rol === 'tecnico' || u.rol === 'admin' || u.rol === 'jefe_pista')
        .map(u => ({
          id: u.id,
          label: u.nombre,
          meta: u.codigo || '',
        }))
        .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    } else if (tipo === 'servicio') {
      items = (this.state.serviciosCatalogo || [])
        .map(c => ({
          id: c.id,
          label: c.nombre,
          meta: c.tiempo_promedio_min ? `${c.tiempo_promedio_min} min` : '',
        }))
        .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    }

    if (filtroTexto) {
      items = items.filter(it => (it.label || '').toLowerCase().includes(filtroTexto));
    }

    if (items.length === 0) {
      list.innerHTML = '<div class="hist-combo-empty">Sin resultados</div>';
      return;
    }

    const seleccionadoId = this.state.filtros[tipo];
    list.innerHTML = items.map(it => `
      <div class="hist-combo-item${seleccionadoId === it.id ? ' is-active' : ''}" data-id="${Utils.escapeHtml(it.id)}">
        <span>${Utils.escapeHtml(it.label || '—')}</span>
        ${it.meta ? `<span class="hist-combo-item-meta">${Utils.escapeHtml(it.meta)}</span>` : ''}
      </div>
    `).join('');

    list.querySelectorAll('.hist-combo-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const id = el.dataset.id;
        console.log('[DEBUG combo click]', { tipo, id, hasUsuarios: (this.state.usuarios || []).length, hasCatalogo: (this.state.serviciosCatalogo || []).length });

        if (!id) {
          console.warn('[DEBUG combo] item sin data-id');
          return;
        }

        // Buscar el item correspondiente en la fuente original (no del closure
        // de items, que puede haber cambiado si se re-rendereó). Para técnico
        // miramos usuarios; para servicio miramos serviciosCatalogo.
        let item = null;
        if (tipo === 'tecnico') {
          const u = (this.state.usuarios || []).find(x => x.id === id);
          if (u) item = { id: u.id, label: u.nombre };
        } else if (tipo === 'servicio') {
          const c = (this.state.serviciosCatalogo || []).find(x => x.id === id);
          if (c) item = { id: c.id, label: c.nombre };
        }

        if (!item) {
          console.warn('[DEBUG combo] no se encontró el item con id:', id);
          return;
        }

        console.log('[DEBUG combo] aplicando selección:', item);

        this.state.filtros[tipo] = item.id;
        this.state.filtros[tipo + 'Label'] = item.label;
        this.cerrarCombobox(combo);
        this.actualizarComboTrigger(combo);
        this.aplicarFiltros();
      });
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
  // AND lógico entre todos los filtros activos. Una orden pasa solo si:
  //  - su placa contiene el texto de filtros.placa (si hay)
  //  - su num_orden contiene el texto de filtros.orden (si hay)
  //  - tiene al menos un servicio del técnico seleccionado (si hay)
  //  - tiene al menos un servicio del catálogo seleccionado (si hay)
  // Si AMBOS técnico y servicio están seleccionados, debe haber UN servicio
  // con ese tecnico_id Y ese servicio_id (no basta con que existan por separado).
  aplicarFiltros() {
    const f = this.state.filtros;
    const periodo = this.state.periodo;
    const estadoFilter = this.state.estado;

    const placaQ = (f.placa || '').trim().toLowerCase();
    const ordenQ = (f.orden || '').trim().toLowerCase();

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

    // Filtro combinado: AND de todos los activos
    let resultado = this.state.ordenes.filter(o => {
      // Período
      if (fechaDesde) {
        const fc = new Date(o.creada_en);
        if (fc < fechaDesde) return false;
      }
      // Estado
      if (estadoFilter !== 'todos' && o.estado !== estadoFilter) return false;
      // Placa
      if (placaQ && !(o.placa || '').toLowerCase().includes(placaQ)) return false;
      // Número de orden
      if (ordenQ && !(o.num_orden || '').toLowerCase().includes(ordenQ)) return false;

      // Filtros técnico/servicio: ambos pueden estar activos. Necesitamos
      // los servicios de esta orden y verificar:
      //  - si hay tecnico Y servicio: existe un servicio que cumple AMBOS
      //  - si solo hay tecnico: existe servicio con ese tecnico_id
      //  - si solo hay servicio: existe servicio con ese servicio_id
      if (f.tecnico || f.servicio) {
        const serviciosOrden = this.state.servicios.filter(s => s.num_orden === o.num_orden);
        const cumple = serviciosOrden.some(s => {
          if (f.tecnico && s.tecnico_id !== f.tecnico) return false;
          if (f.servicio && s.servicio_id !== f.servicio) return false;
          return true;
        });
        if (!cumple) return false;
      }

      return true;
    });

    // Refrescar panel de estadísticas
    this.actualizarStatsCard();

    // Render
    this.renderResultados(resultado);
  },

  // ===== Panel de stats: muestra estadísticas según filtros activos =====
  // Reglas:
  //  - Si hay tecnico Y servicio: stats de ese técnico EN ese servicio,
  //    comparado contra la media del taller en ESE servicio
  //  - Si solo tecnico: stats globales del técnico (todos sus servicios)
  //  - Si solo servicio: stats del taller en ese servicio
  //  - Si nada de eso: panel oculto
  actualizarStatsCard() {
    const card = document.getElementById('hist-stats-card');
    if (!card) return;

    const f = this.state.filtros;
    const tieneTecnico = !!f.tecnico;
    const tieneServicio = !!f.servicio;

    if (!tieneTecnico && !tieneServicio) {
      card.hidden = true;
      return;
    }

    // Buscar servicios completados que cumplen los filtros activos
    const serviciosCoincidentes = (this.state.servicios || []).filter(s => {
      if (s.estado !== 'completado') return false;
      if (!s.tiempo_real_min || s.tiempo_real_min <= 0) return false;
      if (tieneTecnico && s.tecnico_id !== f.tecnico) return false;
      if (tieneServicio && s.servicio_id !== f.servicio) return false;
      return true;
    });

    if (serviciosCoincidentes.length === 0) {
      card.hidden = true;
      return;
    }

    const tiempos = serviciosCoincidentes.map(s => s.tiempo_real_min);
    const total = tiempos.length;
    const promedio = Math.round(tiempos.reduce((a, b) => a + b, 0) / total);
    const minTiempo = Math.min(...tiempos);
    const maxTiempo = Math.max(...tiempos);

    // Determinar título y media de referencia según combinación de filtros
    let titulo = '';
    let subtitulo = '';
    let mediaTallerMin = null;
    let mediaTallerLabel = '';

    if (tieneTecnico && tieneServicio) {
      const u = this.state.usuarios.find(x => x.id === f.tecnico);
      const cat = this.state.serviciosCatalogo.find(c => c.id === f.servicio);
      titulo = `${u?.nombre || 'Técnico'} × ${cat?.nombre || 'Servicio'}`;
      subtitulo = 'Estadísticas específicas del técnico en este servicio';
      // Media del taller para ESE servicio (todos los técnicos)
      const tallerEnServicio = (this.state.servicios || [])
        .filter(s => s.servicio_id === f.servicio && s.estado === 'completado' && s.tiempo_real_min > 0);
      if (tallerEnServicio.length > 0) {
        mediaTallerMin = Math.round(tallerEnServicio.reduce((a, b) => a + b.tiempo_real_min, 0) / tallerEnServicio.length);
        mediaTallerLabel = `Sobre ${tallerEnServicio.length} servicios del taller`;
      } else if (cat?.tiempo_promedio_min) {
        mediaTallerMin = cat.tiempo_promedio_min;
        mediaTallerLabel = 'Mediana del catálogo';
      }
    } else if (tieneTecnico) {
      const u = this.state.usuarios.find(x => x.id === f.tecnico);
      titulo = `${u?.nombre || 'Técnico'} — Estadísticas globales`;
      subtitulo = 'Promedio del técnico en todos los servicios';
      const todos = (this.state.servicios || []).filter(s => s.estado === 'completado' && s.tiempo_real_min > 0);
      if (todos.length > 0) {
        mediaTallerMin = Math.round(todos.reduce((a, b) => a + b.tiempo_real_min, 0) / todos.length);
        mediaTallerLabel = `Sobre ${todos.length} servicios del taller`;
      }
    } else if (tieneServicio) {
      const cat = this.state.serviciosCatalogo.find(c => c.id === f.servicio);
      titulo = `${cat?.nombre || 'Servicio'} — Estadísticas del taller`;
      subtitulo = 'Tiempos reales de todos los técnicos en este servicio';
      if (cat?.tiempo_promedio_min) {
        mediaTallerMin = cat.tiempo_promedio_min;
        mediaTallerLabel = 'Mediana del catálogo';
      }
    }

    // Llenar UI
    document.getElementById('hist-stats-title').textContent = titulo;
    document.getElementById('hist-stats-sub').textContent = subtitulo;
    document.getElementById('hist-stat-count').textContent = total;
    document.getElementById('hist-stat-promedio').textContent = this.formatMin(promedio);
    document.getElementById('hist-stat-min').textContent = this.formatMin(minTiempo);
    document.getElementById('hist-stat-max').textContent = this.formatMin(maxTiempo);

    if (mediaTallerMin !== null) {
      document.getElementById('hist-stat-media-taller').textContent = this.formatMin(mediaTallerMin);
      document.getElementById('hist-stat-media-base').textContent = mediaTallerLabel;
      const diff = promedio - mediaTallerMin;
      const vsEl = document.getElementById('hist-stat-vs-media');
      if (diff < 0) {
        vsEl.textContent = `⚡ ${Math.abs(diff)} min más rápido`;
        vsEl.className = 'hist-stat-extra hist-stat-vs-rapido';
      } else if (diff > 0) {
        vsEl.textContent = `🐢 ${diff} min más lento`;
        vsEl.className = 'hist-stat-extra hist-stat-vs-lento';
      } else {
        vsEl.textContent = '= igual a la media';
        vsEl.className = 'hist-stat-extra';
      }
    } else {
      document.getElementById('hist-stat-media-taller').textContent = '—';
      document.getElementById('hist-stat-media-base').textContent = 'Sin referencia';
      document.getElementById('hist-stat-vs-media').textContent = '—';
      document.getElementById('hist-stat-vs-media').className = 'hist-stat-extra';
    }

    card.hidden = false;
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

    // FIX: Si hay filtro tecnico/servicio, mostrar SOLO los servicios que
    // coinciden con AMBOS filtros (cuando aplica). Si solo hay tecnico,
    // muestra los servicios de ese tecnico. Si solo hay servicio, muestra
    // ese tipo de servicio. Si están los dos, muestra los que cumplen ambos.
    const f = this.state.filtros;
    let serviciosOrden = this.state.servicios.filter(s => s.num_orden === num);

    if (f.tecnico || f.servicio) {
      serviciosOrden = serviciosOrden.filter(s => {
        if (f.tecnico && s.tecnico_id !== f.tecnico) return false;
        if (f.servicio && s.servicio_id !== f.servicio) return false;
        return true;
      });
    }

    const totalServicios = serviciosOrden.length;
    const completados = serviciosOrden.filter(s => s.estado === 'completado').length;
    const cancelados = serviciosOrden.filter(s => s.estado === 'cancelado').length;

    // Tiempo total trabajado en esta orden (suma de tiempo_real_min) — solo de
    // los servicios visibles según filtro
    const tiempoTotalMin = serviciosOrden
      .filter(s => s.estado === 'completado' && s.tiempo_real_min)
      .reduce((acc, s) => acc + s.tiempo_real_min, 0);

    // Técnicos únicos que participaron (en los servicios visibles)
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

    // Badge de velocidad: solo si hay filtro tecnico Y/O servicio activo, y
    // este servicio está completado con tiempo medible. Compara contra la
    // mediana del catálogo: <85% = rápido, >115% = lento, intermedio = normal.
    let velocidadBadge = '';
    const fActiv = this.state.filtros;
    const filtraVelocidad = !!fActiv.tecnico || !!fActiv.servicio;
    if (filtraVelocidad && s.estado === 'completado' && s.tiempo_real_min && tiempoEsperado) {
      const ratio = s.tiempo_real_min / tiempoEsperado;
      if (ratio < 0.85) {
        velocidadBadge = '<span class="hist-servicio-velocidad hist-servicio-velocidad-rapido">⚡ Rápido</span>';
      } else if (ratio > 1.15) {
        velocidadBadge = '<span class="hist-servicio-velocidad hist-servicio-velocidad-lento">🐢 Lento</span>';
      } else {
        velocidadBadge = '<span class="hist-servicio-velocidad hist-servicio-velocidad-normal">≈ Normal</span>';
      }
    }

    return `
      <div class="hist-servicio-row${cancelado ? ' hist-servicio-cancelado' : ''}">
        <div class="hist-servicio-info">
          <div class="hist-servicio-nombre">${Utils.escapeHtml(nombre)}${velocidadBadge}</div>
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
