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
    fotos: [],            // Fotos de los servicios (Fase Fotos)
    fotosUrls: {},        // Cache de URLs firmadas { storage_path: { url, expira_en } }
    gpsKm: [],            // Registros GPS de la placa actualmente cargada
    gpsKmCache: {},       // Cache por placa: { 'TAXI 0384': [...records] }
    gpsKmPlacaCargada: null, // Qué placa está en gpsKm ahora

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

    // CSS para badges de km GPS
    if (!document.getElementById('hist-km-badge-styles')) {
      const s = document.createElement('style');
      s.id = 'hist-km-badge-styles';
      s.textContent = `
        .hist-km-badge {
          display: inline-flex; align-items: center; gap: 3px;
          font-size: 0.72rem; font-weight: 600; letter-spacing: 0.01em;
          color: #5bc8f5; background: rgba(91,200,245,0.12);
          border: 1px solid rgba(91,200,245,0.25);
          border-radius: 10px; padding: 2px 8px;
          white-space: nowrap;
        }
        .hist-km-badge-sm {
          font-size: 0.68rem; padding: 1px 6px;
          color: #5bc8f5; background: rgba(91,200,245,0.10);
          border: 1px solid rgba(91,200,245,0.20);
          border-radius: 8px; margin-left: 6px; font-weight: 500;
        }
        .hist-costo-badge {
          display: inline-flex; align-items: center; gap: 3px;
          font-size: 0.72rem; font-weight: 700;
          color: #ffc107; background: rgba(255,193,7,0.12);
          border: 1px solid rgba(255,193,7,0.3);
          border-radius: 10px; padding: 2px 8px; white-space: nowrap;
        }
        .hist-costo-badge-sm {
          font-size: 0.68rem; padding: 1px 6px;
          color: #fbbf24; background: rgba(251,191,36,0.10);
          border: 1px solid rgba(251,191,36,0.2);
          border-radius: 8px; font-weight: 600;
        }

        /* ===== Modal edición de pausas ===== */
        .hist-pausa-edit-btn {
          background: none; border: none; cursor: pointer;
          font-size: 0.8rem; opacity: 0.45; padding: 2px 4px;
          border-radius: 4px; transition: opacity 0.15s, background 0.15s;
          line-height: 1; flex-shrink: 0;
        }
        .hist-pausa-edit-btn:hover { opacity: 1; background: rgba(255,255,255,0.1); }

        #hist-pausa-modal-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.65);
          z-index: 1000; display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        #hist-pausa-modal {
          background: #0d2137; border: 1px solid rgba(47,127,224,0.4);
          border-radius: 12px; padding: 24px; width: 100%; max-width: 420px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.5);
        }
        #hist-pausa-modal h3 {
          margin: 0 0 6px; font-family: 'Oswald', sans-serif;
          font-size: 1rem; color: #e8f0fe; font-weight: 600;
        }
        #hist-pausa-modal .hist-modal-sub {
          font-size: 0.78rem; color: rgba(255,255,255,0.45);
          margin-bottom: 20px;
        }
        .hist-modal-field { margin-bottom: 16px; }
        .hist-modal-field label {
          display: block; font-size: 0.75rem; font-weight: 600;
          letter-spacing: 0.05em; text-transform: uppercase;
          color: rgba(255,255,255,0.5); margin-bottom: 6px;
        }
        .hist-modal-field input[type="datetime-local"] {
          width: 100%; padding: 9px 12px; box-sizing: border-box;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 8px; color: #e8f0fe;
          font-family: 'Manrope', sans-serif; font-size: 0.9rem;
          color-scheme: dark;
        }
        .hist-modal-field input[type="datetime-local"]:focus {
          outline: none; border-color: #2f7fe0;
        }
        .hist-modal-actions {
          display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;
        }
        .hist-modal-btn-cancel {
          padding: 8px 18px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15);
          background: transparent; color: rgba(255,255,255,0.6);
          font-family: 'Manrope', sans-serif; font-size: 0.88rem; cursor: pointer;
        }
        .hist-modal-btn-cancel:hover { background: rgba(255,255,255,0.07); }
        .hist-modal-btn-save {
          padding: 8px 22px; border-radius: 8px; border: none;
          background: #2f7fe0; color: #fff;
          font-family: 'Manrope', sans-serif; font-size: 0.88rem;
          font-weight: 600; cursor: pointer; transition: background 0.15s;
        }
        .hist-modal-btn-save:hover { background: #1a6dcb; }
        .hist-modal-btn-save:disabled { background: #1a3a5c; color: rgba(255,255,255,0.4); cursor: not-allowed; }
        .hist-modal-error {
          font-size: 0.78rem; color: #f87171; margin-top: 10px; text-align: center;
        }
        .hist-modal-ok {
          font-size: 0.78rem; color: #86efac; margin-top: 10px; text-align: center;
        }
      `;
      document.head.appendChild(s);
    }

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
        if (!id) return;

        // FIX: data-id devuelve siempre string, pero los IDs en la BD pueden
        // ser numéricos (catálogo_servicios usa SERIAL/integer). Comparamos
        // con == (coerción) y como string para cubrir ambos casos.
        const matchId = (x) => String(x.id) === String(id);

        let item = null;
        if (tipo === 'tecnico') {
          const u = (this.state.usuarios || []).find(matchId);
          if (u) item = { id: u.id, label: u.nombre };
        } else if (tipo === 'servicio') {
          const c = (this.state.serviciosCatalogo || []).find(matchId);
          if (c) item = { id: c.id, label: c.nombre };
        }

        if (!item) return;

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
      const [ordenesR, serviciosR, usuariosR, catalogoR, cancR, pausasR, fotosR] = await Promise.all([
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
          .select('id, nombre, codigo, rol, precio_hora'),

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

        // Fotos (Fase Fotos) — solo metadata; URLs firmadas se generan al expandir
        supabaseClient
          .from('fotos_servicio')
          .select('id, servicio_orden_id, tipo, storage_path, subida_por, subida_en, notas'),
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
      this.state.fotos = (fotosR && !fotosR.error) ? (fotosR.data || []) : [];
      // GPS se carga por demanda en cargarGpsPlaca() — no aquí

      Utils.log(`Historial cargado: ${this.state.ordenes.length} órdenes, ${this.state.servicios.length} servicios, ${this.state.pausas.length} pausas, ${this.state.fotos.length} fotos.`);
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
  async aplicarFiltros() {
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
          // Comparación flexible (string vs number): los IDs de BD pueden ser numéricos
          if (f.tecnico && String(s.tecnico_id) !== String(f.tecnico)) return false;
          if (f.servicio && String(s.servicio_id) !== String(f.servicio)) return false;
          return true;
        });
        if (!cumple) return false;
      }

      return true;
    });

    // GPS por demanda: solo si todos los resultados son de una única placa
    // (típicamente cuando hay filtro de placa activo). Escala sin límite.
    const placasUnicas = new Set(resultado.map(o => o.placa).filter(Boolean));
    const placaFija = placasUnicas.size === 1 ? [...placasUnicas][0] : null;

    if (placaFija) {
      await this.cargarGpsPlaca(placaFija);
    } else {
      // Múltiples placas o sin resultados: limpiar GPS del estado
      this.state.gpsKm = [];
      this.state.gpsKmPlacaCargada = null;
    }

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
      // Comparación flexible string/number (los IDs de BD pueden ser numéricos)
      if (tieneTecnico && String(s.tecnico_id) !== String(f.tecnico)) return false;
      if (tieneServicio && String(s.servicio_id) !== String(f.servicio)) return false;
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
      const u = this.state.usuarios.find(x => String(x.id) === String(f.tecnico));
      const cat = this.state.serviciosCatalogo.find(c => String(c.id) === String(f.servicio));
      titulo = `${u?.nombre || 'Técnico'} × ${cat?.nombre || 'Servicio'}`;
      subtitulo = 'Estadísticas específicas del técnico en este servicio';
      // Media del taller para ESE servicio (todos los técnicos)
      const tallerEnServicio = (this.state.servicios || [])
        .filter(s => String(s.servicio_id) === String(f.servicio) && s.estado === 'completado' && s.tiempo_real_min > 0);
      if (tallerEnServicio.length > 0) {
        mediaTallerMin = Math.round(tallerEnServicio.reduce((a, b) => a + b.tiempo_real_min, 0) / tallerEnServicio.length);
        mediaTallerLabel = `Sobre ${tallerEnServicio.length} servicios del taller`;
      } else if (cat?.tiempo_promedio_min) {
        mediaTallerMin = cat.tiempo_promedio_min;
        mediaTallerLabel = 'Mediana del catálogo';
      }
    } else if (tieneTecnico) {
      const u = this.state.usuarios.find(x => String(x.id) === String(f.tecnico));
      titulo = `${u?.nombre || 'Técnico'} — Estadísticas globales`;
      subtitulo = 'Promedio del técnico en todos los servicios';
      const todos = (this.state.servicios || []).filter(s => s.estado === 'completado' && s.tiempo_real_min > 0);
      if (todos.length > 0) {
        mediaTallerMin = Math.round(todos.reduce((a, b) => a + b.tiempo_real_min, 0) / todos.length);
        mediaTallerLabel = `Sobre ${todos.length} servicios del taller`;
      }
    } else if (tieneServicio) {
      const cat = this.state.serviciosCatalogo.find(c => String(c.id) === String(f.servicio));
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

    // Bind clicks en miniaturas de fotos (Fase Fotos)
    list.querySelectorAll('.hist-foto-thumb').forEach(thumb => {
      thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = thumb.dataset.fotoUrl;
        const nota = thumb.dataset.fotoNota || '';
        if (url) this.abrirLightbox(url, nota);
      });
    });

    // Bind clicks en botones de editar pausa (admin)
    list.querySelectorAll('.hist-pausa-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pausaId = parseInt(btn.dataset.pausaId, 10);
        if (!isNaN(pausaId)) this.abrirModalPausa(pausaId);
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
        // Comparación flexible (string vs number)
        if (f.tecnico && String(s.tecnico_id) !== String(f.tecnico)) return false;
        if (f.servicio && String(s.servicio_id) !== String(f.servicio)) return false;
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

    // Costo total de la orden (suma de costo por servicio de cada técnico)
    const costoOrden = serviciosOrden
      .filter(s => s.estado === 'completado' && s.tiempo_real_min)
      .reduce((acc, s) => acc + this.calcularCosto(s.tecnico_id, s.tiempo_real_min), 0);
    const costoOrdenBadge = costoOrden > 0
      ? `<span class="hist-costo-badge">💰 L. ${this.formatLps(costoOrden)}</span>`
      : '';
    // Km desde que se cerró esta orden
    const fechaRefKm = orden.cerrada_en
      || serviciosOrden.filter(s => s.hora_fin).sort((a, b) => b.hora_fin.localeCompare(a.hora_fin))[0]?.hora_fin;
    const kmOrden = fechaRefKm ? this.calcularKmDesde(orden.placa, fechaRefKm) : null;
    const kmBadgeCard = (kmOrden !== null && this.state.gpsKm.some(g => g.placa === orden.placa))
      ? `<span class="hist-km-badge">📍 ${this.formatKm(kmOrden)}</span>`
      : '';

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
              ${kmBadgeCard}
              ${costoOrdenBadge}
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

    // Costo mano de obra total de la orden
    const costoOrden = serviciosOrden
      .filter(s => s.estado === 'completado' && s.tiempo_real_min)
      .reduce((acc, s) => acc + this.calcularCosto(s.tecnico_id, s.tiempo_real_min), 0);

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
        ${costoOrden > 0 ? `
        <div class="hist-resumen-item">
          <span class="hist-resumen-label">Mano de obra</span>
          <span class="hist-resumen-value" style="color:#ffc107;font-weight:700;">L. ${this.formatLps(costoOrden)}</span>
        </div>` : ''}
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
          ${serviciosOrden.map(s => this.renderServicioRow(s, orden.placa)).join('')}
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

  renderServicioRow(s, placa = null) {
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

    // Botón editar servicio (solo admin, solo completados)
    const esAdmin = this.state.profile?.rol === 'admin';
    const editServBtn = (esAdmin && s.estado === 'completado')
      ? `<button class="hist-pausa-edit-btn" data-servicio-id="${s.id}" title="Corregir horario del servicio">✏️</button>`
      : '';
    const costoServicio = (s.estado === 'completado' && s.tiempo_real_min && s.tecnico_id)
      ? this.calcularCosto(s.tecnico_id, s.tiempo_real_min)
      : 0;
    const costoBadge = costoServicio > 0
      ? `<span class="hist-costo-badge hist-costo-badge-sm">L. ${this.formatLps(costoServicio)}</span>`
      : '';

    // Km recorridos desde que se completó este servicio específico
    const kmServicio = (s.estado === 'completado' && s.hora_fin && placa && this.state.gpsKm.some(g => g.placa === placa))
      ? this.calcularKmDesde(placa, s.hora_fin)
      : null;
    const kmServicioBadge = kmServicio !== null
      ? `<span class="hist-km-badge hist-km-badge-sm">📍 hace ${this.formatKm(kmServicio)}</span>`
      : '';

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
          <div class="hist-servicio-nombre">${Utils.escapeHtml(nombre)}${velocidadBadge}${kmServicioBadge}</div>
          ${tecnico !== '—' ? `<div class="hist-servicio-tecnico">Técnico: <strong>${Utils.escapeHtml(tecnico)}</strong>${agregadoPor && agregadoPor !== '—' ? ` · agregado por ${Utils.escapeHtml(agregadoPor)}` : ''}</div>` : ''}
          ${inicio || fin ? `<div class="hist-servicio-tiempos">${inicio ? '▶ ' + inicio : ''}${fin ? ' → ⏹ ' + fin : ''}</div>` : ''}
          ${sospechoso ? `<div class="hist-servicio-sospechoso">⚠ Tiempo sospechoso${tiempoEsperado ? ` (esperado ~${tiempoEsperado} min)` : ''}</div>` : ''}
          ${s.observacion ? `<div class="hist-servicio-obs">"${Utils.escapeHtml(s.observacion)}"</div>` : ''}
          ${this.renderFotosServicioHist(s)}
        </div>
        <div class="hist-servicio-tiempo-real" style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
          <span>${tiempoTexto}</span>
          ${costoBadge}
          ${editServBtn}
        </div>
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

    const esAdmin = this.state.profile?.rol === 'admin';
    const editBtn = esAdmin
      ? `<button class="hist-pausa-edit-btn" data-pausa-id="${p.id}" title="Corregir horario de pausa">✏️</button>`
      : '';

    return `
      <div class="hist-pausa-row">
        <div>
          <div class="hist-pausa-motivo">⏸ ${Utils.escapeHtml(motivoFmt)}${detalleExtra ? ' ' + Utils.escapeHtml(detalleExtra) : ''}</div>
          <div class="hist-pausa-detalle">${Utils.escapeHtml(nombreServ)} · ${Utils.escapeHtml(tecnico)}${Utils.escapeHtml(pausadoPorTxt)}</div>
        </div>
        <div class="hist-pausa-tiempo" style="display:flex;align-items:center;gap:8px;">
          <div>
            <div>${duracionFmt}</div>
            <div style="font-size: 0.7rem; opacity: 0.7;">${horaPausa}${horaReanudacion ? ' → ' + horaReanudacion : ''}</div>
          </div>
          ${editBtn}
        </div>
      </div>
    `;
  },

  // ==================== EXPAND / COLLAPSE ====================
  async toggleOrden(numOrden) {
    if (this.state.ordenesExpandidas.has(numOrden)) {
      this.state.ordenesExpandidas.delete(numOrden);
    } else {
      this.state.ordenesExpandidas.add(numOrden);
      // Generar URLs firmadas para las fotos de esta orden (si no las tenemos)
      await this.cargarUrlsFotosOrden(numOrden);
    }
    this.aplicarFiltros();  // re-render
  },

  // ==================== FOTOS (Fase Fotos) ====================
  /**
   * Genera (en lote) URLs firmadas de 1h para las fotos de una orden.
   * Se cachean en state.fotosUrls para evitar llamadas repetidas.
   */
  async cargarUrlsFotosOrden(numOrden) {
    const serviciosOrden = this.state.servicios.filter(s => s.num_orden === numOrden);
    const idsServ = new Set(serviciosOrden.map(s => s.id));
    const fotosOrden = (this.state.fotos || []).filter(f => idsServ.has(f.servicio_orden_id));

    if (fotosOrden.length === 0) return;

    // Filtrar las que no tenemos en cache o están por vencer
    const ahora = Date.now();
    const pathsAGenerar = fotosOrden
      .filter(f => {
        const cached = this.state.fotosUrls[f.storage_path];
        return !cached || cached.expira_en < ahora;
      })
      .map(f => f.storage_path);

    if (pathsAGenerar.length === 0) return;

    try {
      const { data, error } = await supabaseClient
        .storage
        .from('fotos-servicios')
        .createSignedUrls(pathsAGenerar, 3600);

      if (error) {
        Utils.log('Error firmando URLs de fotos:', error);
        return;
      }

      (data || []).forEach(item => {
        if (item.path) {
          this.state.fotosUrls[item.path] = {
            url: item.signedUrl,
            expira_en: ahora + 3500 * 1000, // 5 seg de margen
          };
        }
      });
    } catch (err) {
      Utils.log('Error inesperado firmando URLs:', err);
    }
  },

  /** Devuelve el HTML de la galería de fotos de un servicio (read-only). */
  renderFotosServicioHist(s) {
    const fotos = (this.state.fotos || []).filter(f => f.servicio_orden_id === s.id);
    if (fotos.length === 0) return '';

    const fotosAntes = fotos.filter(f => f.tipo === 'antes');
    const fotosDespues = fotos.filter(f => f.tipo === 'despues');

    const renderThumb = (f) => {
      const cached = this.state.fotosUrls[f.storage_path];
      const url = cached ? cached.url : '';
      const safeUrl = Utils.escapeHtml(url);
      const tieneNota = f.notas && f.notas.trim().length > 0;
      const safeNota = Utils.escapeHtml(f.notas || '');
      const notaBadge = tieneNota ? `<span class="foto-nota-badge" title="Tiene nota">📝</span>` : '';
      return `
        <div class="hist-foto-thumb" data-foto-url="${safeUrl}" data-foto-nota="${safeNota}">
          ${url ? `<img src="${safeUrl}" alt="Foto" loading="lazy" />` : '<div class="hist-foto-loading">⏳</div>'}
          ${notaBadge}
        </div>`;
    };

    let html = '<div class="hist-fotos">';

    if (fotosAntes.length > 0) {
      html += `
        <div class="hist-fotos-grupo">
          <div class="hist-fotos-label">📷 Antes (${fotosAntes.length})</div>
          <div class="hist-fotos-row">${fotosAntes.map(renderThumb).join('')}</div>
        </div>`;
    }
    if (fotosDespues.length > 0) {
      html += `
        <div class="hist-fotos-grupo">
          <div class="hist-fotos-label">📷 Después (${fotosDespues.length})</div>
          <div class="hist-fotos-row">${fotosDespues.map(renderThumb).join('')}</div>
        </div>`;
    }

    html += '</div>';
    return html;
  },

  /** Asegura que existe el lightbox en el DOM y bindea sus eventos. */
  asegurarLightbox() {
    if (document.getElementById('foto-lightbox')) return;
    const lb = document.createElement('div');
    lb.id = 'foto-lightbox';
    lb.className = 'foto-lightbox';
    lb.hidden = true;
    lb.innerHTML = `
      <div class="foto-lightbox-backdrop" id="foto-lightbox-backdrop"></div>
      <button class="foto-lightbox-close" id="foto-lightbox-close" aria-label="Cerrar">✕</button>
      <div class="foto-lightbox-contenido">
        <img id="foto-lightbox-img" src="" alt="Foto del servicio" />
        <div class="foto-lightbox-nota-wrap" id="foto-lightbox-nota-wrap" hidden>
          <div class="foto-lightbox-nota-header">
            <span class="foto-lightbox-nota-label">📝 Nota</span>
          </div>
          <div class="foto-lightbox-nota-texto" id="foto-lightbox-nota-texto"></div>
        </div>
      </div>
    `;
    document.body.appendChild(lb);
    document.getElementById('foto-lightbox-backdrop').addEventListener('click', () => this.cerrarLightbox());
    document.getElementById('foto-lightbox-close').addEventListener('click', () => this.cerrarLightbox());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cerrarLightbox();
    });
  },

  abrirLightbox(url, nota = '') {
    this.asegurarLightbox();
    const modal = document.getElementById('foto-lightbox');
    const img = document.getElementById('foto-lightbox-img');
    if (!modal || !img) return;
    img.src = url;

    // Mostrar/ocultar nota (read-only en historial)
    const notaWrap = document.getElementById('foto-lightbox-nota-wrap');
    const notaTexto = document.getElementById('foto-lightbox-nota-texto');
    if (notaWrap && notaTexto) {
      if (nota && nota.trim().length > 0) {
        notaTexto.textContent = nota;
        notaWrap.hidden = false;
      } else {
        notaWrap.hidden = true;
      }
    }

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  },

  cerrarLightbox() {
    const modal = document.getElementById('foto-lightbox');
    const img = document.getElementById('foto-lightbox-img');
    if (!modal) return;
    modal.hidden = true;
    if (img) img.src = '';
    document.body.style.overflow = '';
  },

  // ==================== EDICIÓN DE PAUSAS (admin) ====================

  /** Convierte un ISO timestamp a formato YYYY-MM-DDTHH:MM en hora local,
   *  compatible con <input type="datetime-local">. */
  toDatetimeLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  /** Abre el modal de edición de una pausa dado su ID. */
  abrirModalPausa(pausaId) {
    const pausa = this.state.pausas.find(p => p.id === pausaId);
    if (!pausa) return;

    // Limpiar modal anterior si existe
    document.getElementById('hist-pausa-modal-backdrop')?.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'hist-pausa-modal-backdrop';
    backdrop.innerHTML = `
      <div id="hist-pausa-modal" role="dialog" aria-modal="true">
        <h3>✏️ Corregir pausa</h3>
        <div class="hist-modal-sub">
          Corrige el horario real de inicio y fin de la pausa.<br>
          El tiempo trabajado se recalculará automáticamente.
        </div>

        <div class="hist-modal-field">
          <label>Inicio de pausa</label>
          <input type="datetime-local" id="hist-modal-inicio"
            value="${this.toDatetimeLocal(pausa.hora_pausa)}" />
        </div>

        <div class="hist-modal-field">
          <label>Fin de pausa (reanudación)</label>
          <input type="datetime-local" id="hist-modal-fin"
            value="${this.toDatetimeLocal(pausa.hora_reanudacion)}" />
        </div>

        <div id="hist-modal-msg" style="min-height:20px;"></div>

        <div class="hist-modal-actions">
          <button class="hist-modal-btn-cancel" id="hist-modal-cancel">Cancelar</button>
          <button class="hist-modal-btn-save" id="hist-modal-save">Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    // Cerrar al click en el backdrop (fuera del modal)
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    document.getElementById('hist-modal-cancel').addEventListener('click', () => backdrop.remove());
    document.addEventListener('keydown', function cerrarEsc(e) {
      if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', cerrarEsc); }
    });

    document.getElementById('hist-modal-save').addEventListener('click', async () => {
      const inicioStr = document.getElementById('hist-modal-inicio').value;
      const finStr    = document.getElementById('hist-modal-fin').value;
      const msg       = document.getElementById('hist-modal-msg');
      const btnSave   = document.getElementById('hist-modal-save');

      if (!inicioStr || !finStr) {
        msg.innerHTML = '<div class="hist-modal-error">Completa ambas fechas.</div>';
        return;
      }
      const dInicio = new Date(inicioStr);
      const dFin    = new Date(finStr);
      if (dFin <= dInicio) {
        msg.innerHTML = '<div class="hist-modal-error">El fin debe ser después del inicio.</div>';
        return;
      }

      btnSave.disabled = true;
      btnSave.textContent = 'Guardando…';
      msg.innerHTML = '';

      const ok = await this.guardarPausaEditada(pausaId, dInicio.toISOString(), dFin.toISOString());

      if (ok) {
        msg.innerHTML = '<div class="hist-modal-ok">✓ Guardado correctamente</div>';
        setTimeout(() => backdrop.remove(), 900);
      } else {
        btnSave.disabled = false;
        btnSave.textContent = 'Guardar';
        msg.innerHTML = '<div class="hist-modal-error">Error al guardar. Intenta de nuevo.</div>';
      }
    });
  },

  /** Guarda la pausa editada y recalcula tiempo_real_min del servicio. */
  async guardarPausaEditada(pausaId, nuevaHoraPausa, nuevaHoraReanudacion) {
    try {
      // 1. Actualizar historial_pausas
      const { error: errPausa } = await supabaseClient
        .from('historial_pausas')
        .update({ hora_pausa: nuevaHoraPausa, hora_reanudacion: nuevaHoraReanudacion })
        .eq('id', pausaId);

      if (errPausa) throw errPausa;

      // 2. Actualizar estado local
      const pausaIdx = this.state.pausas.findIndex(p => p.id === pausaId);
      if (pausaIdx !== -1) {
        this.state.pausas[pausaIdx].hora_pausa = nuevaHoraPausa;
        this.state.pausas[pausaIdx].hora_reanudacion = nuevaHoraReanudacion;
      }

      // 3. Recalcular tiempo_real_min del servicio afectado
      const pausa = this.state.pausas[pausaIdx];
      if (pausa) await this.recalcularTiempoServicio(pausa.servicio_orden_id);

      // 4. Re-render con los datos actualizados
      this.aplicarFiltros();
      return true;

    } catch (err) {
      Utils.log('Error guardando pausa editada:', err);
      return false;
    }
  },

  /** Recalcula tiempo_real_min = (hora_fin - hora_inicio) - suma_pausas
   *  y lo guarda en servicios_orden. */
  async recalcularTiempoServicio(servicioOrdenId) {
    const servicio = this.state.servicios.find(s => s.id === servicioOrdenId);
    if (!servicio || !servicio.hora_inicio || !servicio.hora_fin) return;

    // Tiempo total transcurrido en minutos
    const totalElapsedMin = Math.round(
      (new Date(servicio.hora_fin) - new Date(servicio.hora_inicio)) / 60000
    );

    // Suma de pausas completas de este servicio (con estado local actualizado)
    const pausasServicio = this.state.pausas.filter(
      p => p.servicio_orden_id === servicioOrdenId && p.hora_pausa && p.hora_reanudacion
    );
    const totalPausasMin = pausasServicio.reduce((acc, p) => {
      return acc + Math.round((new Date(p.hora_reanudacion) - new Date(p.hora_pausa)) / 60000);
    }, 0);

    const nuevoTiempoReal = Math.max(0, totalElapsedMin - totalPausasMin);

    // Actualizar BD
    const { error } = await supabaseClient
      .from('servicios_orden')
      .update({ tiempo_real_min: nuevoTiempoReal })
      .eq('id', servicioOrdenId);

    if (error) {
      Utils.log('Error actualizando tiempo_real_min:', error);
      return;
    }

    // Actualizar estado local
    const idx = this.state.servicios.findIndex(s => s.id === servicioOrdenId);
    if (idx !== -1) this.state.servicios[idx].tiempo_real_min = nuevoTiempoReal;

    Utils.log(`tiempo_real_min recalculado: ${nuevoTiempoReal} min para servicio ${servicioOrdenId}`);
  },

  // ==================== GPS KM ====================
  /**
   * Carga los registros de gps_km para una placa específica.
   * Usa caché en memoria para no re-consultar en cada cambio de filtro.
   * Solo ~50-200 filas por placa — escala sin límite de tabla.
   */
  async cargarGpsPlaca(placa) {
    if (!placa) return;

    // Ya está en caché
    if (this.state.gpsKmCache[placa]) {
      this.state.gpsKm = this.state.gpsKmCache[placa];
      this.state.gpsKmPlacaCargada = placa;
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from('gps_km')
        .select('placa, fecha, metros_registrado')
        .eq('placa', placa);

      if (error) {
        Utils.log('GPS fetch error:', error);
        return;
      }

      const registros = data || [];
      this.state.gpsKmCache[placa] = registros;  // guardar en caché
      this.state.gpsKm = registros;
      this.state.gpsKmPlacaCargada = placa;

      Utils.log(`GPS cargado para ${placa}: ${registros.length} registros.`);
    } catch (err) {
      Utils.log('Error inesperado cargando GPS:', err);
    }
  },

  /**
   * Suma los metros registrados en gps_km para una placa desde una fecha/hora
   * dada hasta hoy, excluyendo registros con valor 1001 (no movió).
   * Retorna km con un decimal.
   */
  calcularKmDesde(placa, fechaISO) {
    if (!placa || !fechaISO) return null;
    const fechaLimite = fechaISO.substring(0, 10); // 'YYYY-MM-DD'
    const metros = (this.state.gpsKm || [])
      .filter(g =>
        g.placa === placa &&
        g.fecha > fechaLimite &&
        g.metros_registrado !== 1001
      )
      .reduce((sum, g) => sum + (g.metros_registrado || 0), 0);
    return Math.round(metros / 100) / 10; // km con 1 decimal
  },

  /**
   * Formatea un valor de km para mostrar: "< 1 km", "245.3 km", "1,234.5 km"
   */
  formatKm(km) {
    if (km === null || km === undefined) return '—';
    if (km < 1) return '< 1 km';
    return km.toLocaleString('es-HN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
  },

  // ==================== COSTO MANO DE OBRA ====================
  /**
   * Calcula el costo de un servicio = tiempo_real_min / 60 * precio_hora del técnico.
   * Retorna 0 si el técnico no tiene precio_hora configurado.
   */
  calcularCosto(tecnicoId, tiempoMin) {
    if (!tecnicoId || !tiempoMin) return 0;
    const u = (this.state.usuarios || []).find(x => x.id === tecnicoId);
    const precioHora = u?.precio_hora ? Number(u.precio_hora) : 0;
    if (!precioHora) return 0;
    return Math.round((tiempoMin / 60) * precioHora * 100) / 100;
  },

  /** Formatea un valor en Lempiras: "1,234.56" */
  formatLps(val) {
    if (val === null || val === undefined) return '—';
    return Number(val).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
