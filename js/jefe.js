/**
 * jefe.js — Lógica del Jefe de Pista
 *
 * Funciones:
 *  - Cargar lista de órdenes desde Supabase
 *  - Mostrar contadores KPI
 *  - Filtrar por pestañas (activas / completadas / todas)
 *  - Modal "Nueva Orden": autocompletado de placa, selector de servicios, prioridad
 *  - Realtime: actualización automática cuando cambian las órdenes
 *  - Crear orden con sus servicios asociados
 */

const Jefe = {

  // Estado interno
  state: {
    profile: null,
    ordenes: [],         // Lista actual de órdenes
    vehiculos: {},       // Cache de vehículos por placa
    categorias: [],      // Catálogo de categorías
    catalogo: [],        // Catálogo de servicios
    tabActiva: 'activas',
    categoriaActiva: null, // null = todas
    serviciosSeleccionados: new Set(),
    prioridad: 'normal',
    realtimeChannel: null,
    alertasMtto: [],     // Alertas de mantenimiento KM (Fase 4b)
    alertasExpandidas: false,
  },

  // ==================== INIT ====================
  async init() {
    Utils.log('Iniciando vista Jefe...');

    const profile = await Auth.requireAuth();
    if (!profile) return;

    if (profile.rol !== 'jefe_pista' && profile.rol !== 'admin') {
      alert('No tienes permisos para esta pantalla.');
      Auth.logout();
      return;
    }

    this.state.profile = profile;
    document.getElementById('user-nombre-header').textContent = profile.nombre;

    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

    await this.cargarDatosBase();
    await this.cargarOrdenes();
    this.cargarAlertasMtto();
    this.bindEventos();
    this.activarRealtime();
  },

  // ==================== DATOS BASE ====================
  async cargarDatosBase() {
    try {
      const [catRes, servRes] = await Promise.all([
        supabaseClient
          .from('categorias')
          .select('id, nombre, orden_visual, activa')
          .eq('activa', true)
          .order('orden_visual'),
        supabaseClient
          .from('catalogo_servicios')
          .select('id, nombre, categoria_id, tiempo_promedio_min, alerta_km_umbral, activo')
          .eq('activo', true)
          .order('nombre'),
      ]);

      if (catRes.error) throw catRes.error;
      if (servRes.error) throw servRes.error;

      this.state.categorias = catRes.data;
      this.state.catalogo = servRes.data;

      Utils.log('Catálogo cargado:', this.state.categorias.length, 'categorías,', this.state.catalogo.length, 'servicios');
    } catch (err) {
      Utils.log('Error cargando catálogo:', err);
      alert('No se pudo cargar el catálogo de servicios.');
    }
  },

  // ==================== ALERTAS DE MANTENIMIENTO (Fase 4b) ====================
  async cargarAlertasMtto() {
    try {
      const { data, error } = await supabaseClient.rpc('f_alertas_flota');
      if (error) throw error;
      this.state.alertasMtto = data || [];
      this.renderAlertasMtto();
    } catch (err) {
      Utils.log('Error cargando alertas mantenimiento:', err);
      // Si la función no existe (BD vieja), simplemente ocultar la sección
      const sec = document.getElementById('alertas-mtto-section');
      if (sec) sec.hidden = true;
    }
  },

  renderAlertasMtto() {
    const sec = document.getElementById('alertas-mtto-section');
    const lista = document.getElementById('alertas-mtto-lista');
    const desc = document.getElementById('alertas-mtto-desc');
    const icon = document.getElementById('alertas-mtto-icon');
    const toggleBtn = document.getElementById('alertas-mtto-toggle');
    if (!sec) return;

    const alertas = this.state.alertasMtto;
    if (!alertas || alertas.length === 0) {
      sec.hidden = true;
      return;
    }

    const vencidas = alertas.filter(a => a.estado === 'vencido').length;
    const proximas = alertas.filter(a => a.estado === 'proximo').length;

    icon.textContent = vencidas > 0 ? '🔴' : '🟡';
    desc.textContent = `${vencidas} vencida${vencidas !== 1 ? 's' : ''} · ${proximas} próxima${proximas !== 1 ? 's' : ''}`;
    sec.hidden = false;

    // Agrupar por placa para mostrar una fila por vehículo con sus servicios
    const porPlaca = {};
    alertas.forEach(a => {
      if (!porPlaca[a.placa]) {
        porPlaca[a.placa] = {
          placa: a.placa,
          marca: a.marca,
          modelo: a.modelo,
          servicios: [],
          peor_estado: 'proximo',
          gps_viejo: a.km_gps_desactualizado,
        };
      }
      porPlaca[a.placa].servicios.push(a);
      if (a.estado === 'vencido') porPlaca[a.placa].peor_estado = 'vencido';
    });

    const filas = Object.values(porPlaca).sort((a, b) => {
      if (a.peor_estado !== b.peor_estado) return a.peor_estado === 'vencido' ? -1 : 1;
      return 0;
    });

    lista.innerHTML = filas.map(v => {
      const dotClass = v.peor_estado === 'vencido' ? 'alerta-dot-rojo' : 'alerta-dot-amarillo';
      const gpsHint = v.gps_viejo ? '<span class="alerta-gps-viejo" title="GPS posiblemente desactualizado">⏱</span>' : '';
      const servicios = v.servicios.map(s => {
        const cls = s.estado === 'vencido' ? 'alerta-serv-vencido' : 'alerta-serv-proximo';
        let detalle = '';
        if (s.km_recorridos != null && s.intervalo_km) {
          detalle = `${Utils.escapeHtml(String(s.km_recorridos))}/${Utils.escapeHtml(String(s.intervalo_km))} km`;
        } else if (s.dias_transcurridos != null && s.intervalo_dias) {
          detalle = `${Utils.escapeHtml(String(s.dias_transcurridos))}/${Utils.escapeHtml(String(s.intervalo_dias))} días`;
        }
        return `<span class="alerta-serv ${cls}">${Utils.escapeHtml(s.servicio_nombre)} <small>${detalle}</small></span>`;
      }).join('');

      return `
        <div class="alerta-mtto-row" data-placa="${Utils.escapeHtml(v.placa)}">
          <span class="alerta-dot ${dotClass}"></span>
          <div class="alerta-row-info">
            <div class="alerta-row-placa">${Utils.escapeHtml(v.placa)} ${gpsHint}</div>
            <div class="alerta-row-vehiculo">${Utils.escapeHtml(v.marca || '')} ${Utils.escapeHtml(v.modelo || '')}</div>
          </div>
          <div class="alerta-row-servicios">${servicios}</div>
          <button class="btn-crear-mtto" data-placa="${Utils.escapeHtml(v.placa)}">+ Orden</button>
        </div>
      `;
    }).join('');

    // Click en botón "+ Orden" → crear nueva orden con servicios pre-seleccionados
    lista.querySelectorAll('.btn-crear-mtto').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const placa = btn.dataset.placa;
        this.crearOrdenDesdeAlerta(placa);
      });
    });

    // Toggle expandir/colapsar
    if (!toggleBtn.dataset.bound) {
      toggleBtn.dataset.bound = 'true';
      toggleBtn.addEventListener('click', () => {
        this.state.alertasExpandidas = !this.state.alertasExpandidas;
        lista.hidden = !this.state.alertasExpandidas;
        toggleBtn.textContent = this.state.alertasExpandidas ? 'Ocultar' : 'Ver';
      });
    }
  },

  crearOrdenDesdeAlerta(placa) {
    const alertas = this.state.alertasMtto.filter(a => a.placa === placa);
    if (alertas.length === 0) return;

    // Pre-cargar la placa y los servicios alertados en el modal de nueva orden
    this.abrirModal();

    setTimeout(() => {
      // Setear placa
      const inputPlaca = document.getElementById('placa');
      inputPlaca.value = placa;
      this.buscarVehiculo();

      // Pre-seleccionar los servicios alertados (vencidos primero)
      const idsAlertados = new Set(alertas.map(a => a.servicio_id));
      this.state.serviciosSeleccionados = new Set(idsAlertados);

      // Sugerir motivo
      const inputMotivo = document.getElementById('motivo');
      const vencidos = alertas.filter(a => a.estado === 'vencido').length;
      inputMotivo.value = vencidos > 0
        ? 'Mantenimiento preventivo (servicios vencidos)'
        : 'Mantenimiento preventivo';

      // Re-render para mostrar los servicios marcados
      this.renderServicios();
      this.actualizarContador();
    }, 200);
  },

  // ==================== ÓRDENES ====================
  async cargarOrdenes() {
    try {
      const { data, error } = await supabaseClient
        .from('ordenes')
        .select(`
          num_orden, placa, prioridad, estado, creada_en, cerrada_en, motivo,
          servicios_orden ( id, estado, servicio_id )
        `)
        .order('creada_en', { ascending: false })
        .limit(100);

      if (error) throw error;

      this.state.ordenes = data || [];
      this.renderOrdenes();
      this.renderKPIs();
    } catch (err) {
      Utils.log('Error cargando órdenes:', err);
    }
  },

  renderKPIs() {
    const ords = this.state.ordenes;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const enTaller = ords.filter(o => o.estado !== 'completada').length;
    const ingresosHoy = ords.filter(o => new Date(o.creada_en) >= hoy).length;
    const enProceso = ords.filter(o => o.estado === 'en_progreso').length;
    const completadas = ords.filter(o => o.estado === 'completada').length;
    const completadasHoy = ords.filter(o =>
      o.estado === 'completada' && o.cerrada_en && new Date(o.cerrada_en) >= hoy
    ).length;

    document.getElementById('kpi-en-taller').textContent = enTaller;
    document.getElementById('kpi-ingresos-hoy').textContent = ingresosHoy;
    document.getElementById('kpi-en-proceso').textContent = enProceso;
    document.getElementById('kpi-completadas-hoy').textContent = completadasHoy;

    // Actualizar contadores en pestañas
    document.getElementById('count-activas').textContent = enTaller;

    // Actualizar también las otras pestañas si existen los spans
    const tabComp = document.querySelector('[data-tab="completadas"]');
    const tabTodas = document.querySelector('[data-tab="todas"]');

    if (tabComp) {
      let span = tabComp.querySelector('span');
      if (!span && completadas > 0) {
        span = document.createElement('span');
        tabComp.appendChild(span);
      }
      if (span) {
        span.textContent = completadas;
        span.style.display = completadas > 0 ? '' : 'none';
      }
    }

    if (tabTodas) {
      let span = tabTodas.querySelector('span');
      if (!span && ords.length > 0) {
        span = document.createElement('span');
        tabTodas.appendChild(span);
      }
      if (span) {
        span.textContent = ords.length;
        span.style.display = ords.length > 0 ? '' : 'none';
      }
    }
  },

  renderOrdenes() {
    const tab = this.state.tabActiva;
    let filtradas = this.state.ordenes;

    if (tab === 'activas') {
      filtradas = filtradas.filter(o => o.estado !== 'completada');
    } else if (tab === 'completadas') {
      filtradas = filtradas.filter(o => o.estado === 'completada');
    }

    // Ordenar: urgentes primero, luego por fecha desc
    filtradas.sort((a, b) => {
      if (a.prioridad !== b.prioridad) {
        return a.prioridad === 'urgente' ? -1 : 1;
      }
      return new Date(b.creada_en) - new Date(a.creada_en);
    });

    const list = document.getElementById('orders-list');

    if (filtradas.length === 0) {
      const mensaje = tab === 'completadas'
        ? 'Aún no hay órdenes completadas.'
        : tab === 'todas'
          ? 'No hay órdenes registradas.'
          : 'Sin órdenes activas.';

      const sub = tab === 'activas'
        ? 'Presiona <strong>+ Nueva orden</strong> para crear la primera.'
        : '';

      list.innerHTML = `
        <div class="empty-state">
          <p>${mensaje}</p>
          ${sub ? `<p style="color: var(--text-dim); font-size: 0.85rem; margin-top: 0.5rem;">${sub}</p>` : ''}
        </div>
      `;
      return;
    }

    list.innerHTML = filtradas.map(o => this.renderOrdenRow(o)).join('');
  },

  renderOrdenRow(orden) {
    const totalServ = orden.servicios_orden?.length || 0;
    const completados = orden.servicios_orden?.filter(s => s.estado === 'completado').length || 0;

    const progresoBadge = totalServ === 0
      ? '<span class="badge">—</span>'
      : completados === totalServ
        ? `<span class="badge badge-success">${completados}/${totalServ}</span>`
        : completados > 0
          ? `<span class="badge badge-info">${completados}/${totalServ}</span>`
          : `<span class="badge">${completados}/${totalServ}</span>`;

    let estadoBadge;
    if (orden.estado === 'completada') {
      estadoBadge = '<span class="badge badge-completada">Completada</span>';
    } else if (orden.prioridad === 'urgente') {
      estadoBadge = '<span class="badge badge-urgente">Urgente</span>';
    } else if (orden.estado === 'en_progreso') {
      estadoBadge = '<span class="badge badge-normal">En proceso</span>';
    } else {
      estadoBadge = '<span class="badge badge-normal">Abierta</span>';
    }

    // Servicios: nombres separados por coma
    const nombresServ = (orden.servicios_orden || [])
      .map(s => {
        const cat = this.state.catalogo.find(c => c.id === s.servicio_id);
        return cat?.nombre || '';
      })
      .filter(Boolean)
      .join(' · ');

    const rowClass = orden.prioridad === 'urgente' && orden.estado !== 'completada' ? 'order-row row-urgente' : 'order-row';

    return `
      <div class="${rowClass}" data-orden="${Utils.escapeHtml(orden.num_orden)}">
        <div class="col-orden">${Utils.escapeHtml(orden.num_orden)}</div>
        <div class="col-placa">${Utils.escapeHtml(orden.placa)}</div>
        <div class="col-servicios">${Utils.escapeHtml(nombresServ || orden.motivo || '—')}</div>
        <div class="col-progreso">${progresoBadge}</div>
        <div class="col-estado">${estadoBadge}</div>
      </div>
    `;
  },

  // ==================== EVENTOS ====================
  bindEventos() {
    // Tabs
    document.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('tab-active'));
        btn.classList.add('tab-active');
        this.state.tabActiva = btn.dataset.tab;
        this.renderOrdenes();
      });
    });

    // Botón Nueva Orden
    document.getElementById('btn-nueva-orden').addEventListener('click', () => this.abrirModal());
    document.getElementById('modal-close-btn').addEventListener('click', () => this.cerrarModal());
    document.getElementById('btn-cancelar').addEventListener('click', () => this.cerrarModal());

    // Click fuera del modal cierra
    document.querySelector('.modal-backdrop').addEventListener('click', () => this.cerrarModal());

    // Escape cierra modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('modal-nueva-orden').hidden) {
        this.cerrarModal();
      }
    });

    // Auto-mayúsculas en placa + autocompletar
    const placaInput = document.getElementById('placa');
    placaInput.addEventListener('input', (e) => {
      const start = e.target.selectionStart;
      e.target.value = e.target.value.toUpperCase();
      e.target.setSelectionRange(start, start);
    });
    placaInput.addEventListener('blur', () => this.buscarVehiculo());

    // Toggle prioridad
    document.querySelectorAll('.prio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.prio-btn').forEach(b => b.classList.remove('prio-active'));
        btn.classList.add('prio-active');
        this.state.prioridad = btn.dataset.prio;
      });
    });

    // Submit del formulario
    document.getElementById('form-nueva-orden').addEventListener('submit', (e) => {
      e.preventDefault();
      this.crearOrden();
    });

    // Click en una fila de orden -> abre detalle
    document.getElementById('orders-list').addEventListener('click', (e) => {
      const row = e.target.closest('.order-row');
      if (row) {
        const num = row.dataset.orden;
        if (num) {
          window.location.href = `orden-detalle.html?orden=${encodeURIComponent(num)}`;
        }
      }
    });
  },

  // ==================== MODAL ====================
  abrirModal() {
    // Reset estado
    this.state.serviciosSeleccionados.clear();
    this.state.categoriaActiva = null;
    this.state.prioridad = 'normal';

    document.getElementById('form-nueva-orden').reset();
    // Marca y modelo: deshabilitados por defecto, se habilitan si la placa es nueva
    this.deshabilitarVehiculoCampos();
    document.getElementById('placa-hint').textContent = 'Digita la placa';
    document.getElementById('placa-hint').style.color = '';
    document.getElementById('form-error').hidden = true;
    document.querySelectorAll('.prio-btn').forEach(b => b.classList.toggle('prio-active', b.dataset.prio === 'normal'));

    this.renderCategorias();
    this.renderServicios();
    this.actualizarContador();

    document.getElementById('modal-nueva-orden').hidden = false;
    setTimeout(() => document.getElementById('placa').focus(), 100);
  },

  cerrarModal() {
    document.getElementById('modal-nueva-orden').hidden = true;
  },

  // ==================== AUTOCOMPLETADO PLACA ====================
  async buscarVehiculo() {
    const placa = document.getElementById('placa').value.trim().toUpperCase();
    if (!placa) {
      document.getElementById('marca').value = '';
      document.getElementById('modelo').value = '';
      this.deshabilitarVehiculoCampos();
      return;
    }

    if (this.state.vehiculos[placa]) {
      this.aplicarVehiculo(this.state.vehiculos[placa]);
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from('vehiculos')
        .select('placa, marca, modelo, anio, km_gps_actual, activo')
        .eq('placa', placa)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        this.state.vehiculos[placa] = data;
        this.aplicarVehiculo(data);
      } else {
        // Vehículo nuevo: habilitar marca y modelo para que el jefe los digite
        document.getElementById('marca').value = '';
        document.getElementById('modelo').value = '';
        this.habilitarVehiculoCampos();
        document.getElementById('placa-hint').textContent = 'Vehículo nuevo (digita marca y modelo)';
        document.getElementById('placa-hint').style.color = 'var(--amarillo)';
      }
    } catch (err) {
      Utils.log('Error buscando vehículo:', err);
    }
  },

  aplicarVehiculo(v) {
    document.getElementById('marca').value = v.marca || '';
    document.getElementById('modelo').value = `${v.modelo || ''}${v.anio ? ' ' + v.anio : ''}`.trim();
    this.deshabilitarVehiculoCampos();
    document.getElementById('placa-hint').textContent = `KM GPS actual: ${v.km_gps_actual || 0}`;
    document.getElementById('placa-hint').style.color = 'var(--text-dim)';
    if (v.km_gps_actual && !document.getElementById('km-ingreso').value) {
      document.getElementById('km-ingreso').value = v.km_gps_actual;
    }
  },

  habilitarVehiculoCampos() {
    const marca = document.getElementById('marca');
    const modelo = document.getElementById('modelo');
    marca.disabled = false;
    modelo.disabled = false;
    marca.classList.remove('field-disabled');
    modelo.classList.remove('field-disabled');
    marca.required = true;
    modelo.required = true;
  },

  deshabilitarVehiculoCampos() {
    const marca = document.getElementById('marca');
    const modelo = document.getElementById('modelo');
    marca.disabled = true;
    modelo.disabled = true;
    marca.classList.add('field-disabled');
    modelo.classList.add('field-disabled');
    marca.required = false;
    modelo.required = false;
  },

  // ==================== CATEGORÍAS Y SERVICIOS ====================
  renderCategorias() {
    const cont = document.getElementById('categorias-chips');
    const total = this.state.serviciosSeleccionados.size;

    const todas = `<button type="button" class="cat-chip ${this.state.categoriaActiva === null ? 'cat-active' : ''}" data-cat="all">Todas <span class="cat-count">${total}</span></button>`;

    const chips = this.state.categorias.map(c => {
      const count = [...this.state.serviciosSeleccionados]
        .filter(id => this.state.catalogo.find(s => s.id === id)?.categoria_id === c.id)
        .length;
      const active = this.state.categoriaActiva === c.id ? 'cat-active' : '';
      const countHtml = count > 0 ? `<span class="cat-count">${count}</span>` : '';
      return `<button type="button" class="cat-chip ${active}" data-cat="${c.id}">${Utils.escapeHtml(c.nombre)} ${countHtml}</button>`;
    }).join('');

    cont.innerHTML = todas + chips;

    cont.querySelectorAll('.cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const v = chip.dataset.cat;
        this.state.categoriaActiva = v === 'all' ? null : parseInt(v, 10);
        this.renderCategorias();
        this.renderServicios();
      });
    });
  },

  renderServicios() {
    const cont = document.getElementById('servicios-grid');
    const filtrados = this.state.categoriaActiva === null
      ? this.state.catalogo
      : this.state.catalogo.filter(s => s.categoria_id === this.state.categoriaActiva);

    if (filtrados.length === 0) {
      cont.innerHTML = '<div class="servicio-empty">No hay servicios en esta categoría.</div>';
      return;
    }

    cont.innerHTML = filtrados.map(s => {
      const sel = this.state.serviciosSeleccionados.has(s.id);
      const tiempo = s.tiempo_promedio_min ? `~${s.tiempo_promedio_min} min` : 'sin datos';
      return `
        <label class="servicio-item ${sel ? 'servicio-selected' : ''}" data-sid="${s.id}">
          <input type="checkbox" ${sel ? 'checked' : ''} />
          <div class="servicio-info">
            <div class="servicio-nombre">${Utils.escapeHtml(s.nombre)}</div>
            <div class="servicio-meta">${tiempo}</div>
          </div>
        </label>
      `;
    }).join('');

    cont.querySelectorAll('.servicio-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Si el click fue en el checkbox, no duplicar
        if (e.target.tagName === 'INPUT') return;
        e.preventDefault();
        const checkbox = item.querySelector('input');
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      });
      item.querySelector('input').addEventListener('change', (e) => {
        const id = parseInt(item.dataset.sid, 10);
        if (e.target.checked) {
          this.state.serviciosSeleccionados.add(id);
        } else {
          this.state.serviciosSeleccionados.delete(id);
        }
        item.classList.toggle('servicio-selected', e.target.checked);
        this.actualizarContador();
        this.renderCategorias(); // Para refrescar contadores en chips
      });
    });
  },

  actualizarContador() {
    const n = this.state.serviciosSeleccionados.size;
    document.getElementById('servicios-counter').textContent = `${n} seleccionado${n !== 1 ? 's' : ''}`;

    // Tiempo estimado
    const minutos = [...this.state.serviciosSeleccionados]
      .map(id => this.state.catalogo.find(s => s.id === id)?.tiempo_promedio_min || 0)
      .reduce((a, b) => a + b, 0);

    const tiempoEl = document.getElementById('tiempo-estimado');
    if (minutos === 0) {
      tiempoEl.textContent = n > 0 ? 'Tiempo estimado: sin datos' : 'Tiempo estimado: —';
    } else {
      const horas = Math.floor(minutos / 60);
      const mins = minutos % 60;
      tiempoEl.textContent = horas > 0
        ? `Tiempo estimado: ${horas}h ${mins}min`
        : `Tiempo estimado: ${mins} min`;
    }

    // Botón crear habilitado/deshabilitado
    document.getElementById('btn-crear').disabled = n === 0;
  },

  // ==================== CREAR ORDEN ====================
  async crearOrden() {
    const placa = document.getElementById('placa').value.trim().toUpperCase();
    const motivo = document.getElementById('motivo').value.trim();
    const problema = document.getElementById('problema').value.trim();
    const km = parseInt(document.getElementById('km-ingreso').value, 10);
    const servicios = [...this.state.serviciosSeleccionados];

    // Validaciones
    if (!placa) return this.errorForm('La placa es obligatoria.');
    if (!motivo) return this.errorForm('El motivo es obligatorio.');
    if (isNaN(km) || km < 0) return this.errorForm('KM ingreso inválido.');
    if (servicios.length === 0) return this.errorForm('Selecciona al menos 1 servicio.');

    const btn = document.getElementById('btn-crear');
    btn.disabled = true;
    btn.textContent = 'Creando...';

    try {
      // Si el vehículo no existe, crearlo
      if (!this.state.vehiculos[placa]) {
        const marca = document.getElementById('marca').value.trim().toUpperCase();
        const modeloRaw = document.getElementById('modelo').value.trim().toUpperCase();

        // Validar antes del insert
        if (!marca) {
          btn.disabled = false;
          btn.textContent = 'Crear orden';
          return this.errorForm('La marca es obligatoria para vehículos nuevos.');
        }
        if (!modeloRaw) {
          btn.disabled = false;
          btn.textContent = 'Crear orden';
          return this.errorForm('El modelo es obligatorio para vehículos nuevos.');
        }

        // Extraer año si viene al final del modelo (ej: "CIVIC 2020" → modelo="CIVIC", anio=2020)
        let modelo = modeloRaw;
        let anio = null;
        const yearMatch = modeloRaw.match(/^(.+?)\s+((?:19|20)\d{2})\s*$/);
        if (yearMatch) {
          modelo = yearMatch[1].trim();
          anio = parseInt(yearMatch[2], 10);
        }

        const insertData = {
          placa,
          marca,
          modelo,
          km_gps_actual: km,
          fecha_ultimo_km_gps: new Date().toISOString(),
          activo: true,
        };
        if (anio) insertData.anio = anio;

        const { error: vErr } = await supabaseClient
          .from('vehiculos')
          .insert(insertData);
        if (vErr) throw vErr;
      }

      // Crear orden (el trigger genera num_orden automáticamente)
      const { data: ordenData, error: oErr } = await supabaseClient
        .from('ordenes')
        .insert({
          num_orden: '',  // El trigger lo asigna
          placa,
          km_ingreso: km,
          motivo,
          problema: problema || null,
          prioridad: this.state.prioridad,
          estado: 'abierta',
          creada_por: this.state.profile.id,
        })
        .select('num_orden')
        .single();

      if (oErr) throw oErr;

      const num_orden = ordenData.num_orden;

      // Insertar servicios_orden
      const filas = servicios.map(sid => ({
        num_orden,
        servicio_id: sid,
        estado: 'pendiente',
        agregado_por: this.state.profile.id,
      }));

      const { error: sErr } = await supabaseClient
        .from('servicios_orden')
        .insert(filas);

      if (sErr) throw sErr;

      Utils.log('Orden creada:', num_orden);
      this.cerrarModal();
      await this.cargarOrdenes();

    } catch (err) {
      Utils.log('Error creando orden:', err);
      this.errorForm(err.message || 'No se pudo crear la orden.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Crear orden';
    }
  },

  errorForm(msg) {
    const el = document.getElementById('form-error');
    el.textContent = msg;
    el.hidden = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  // ==================== REALTIME ====================
  activarRealtime() {
    if (this.state.realtimeChannel) return;

    this.state.realtimeChannel = supabaseClient
      .channel('jefe-ordenes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, () => {
        Utils.log('Realtime: cambio en ordenes');
        this.cargarOrdenes();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios_orden' }, () => {
        Utils.log('Realtime: cambio en servicios_orden');
        this.cargarOrdenes();
        this.cargarAlertasMtto();
      })
      .subscribe();

    Utils.log('Realtime activado');
  },
};

// Arranque
document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    console.error('Supabase no inicializado');
    return;
  }
  Jefe.init();
});
