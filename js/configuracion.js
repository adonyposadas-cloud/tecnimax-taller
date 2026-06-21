/**
 * config.js — Pantalla de configuración del taller (solo admin)
 *
 * Tres secciones:
 *  A. Catálogo de servicios — agregar/editar/activar/desactivar servicios.
 *  B. Intervalos de mantenimiento — editar km/días/activar.
 *  C. Grupos de WhatsApp — editar invite_link.
 *
 * Restricción: solo profile.rol === 'admin' puede entrar.
 */

const Configuracion = {

  state: {
    profile: null,
    catalogo: [],
    categorias: [],
    intervalos: [],
    grupos: [],
    usuarios: [],
    busquedaCatalogo: '',
    seccionExpandida: 'catalogo',  // catalogo | intervalos | grupos | kmgps | usuarios
    editando: null,  // { tipo, id }
    resetPinUsuario: null,  // {id, nombre, codigo} cuando se está reseteando un PIN

    // ===== Módulo Importar KM (GPS) =====
    kmgps: {
      archivo: null,           // File object
      filasParseadas: [],      // [{ placa, fecha, metros, km, estado, error }]
      filasValidas: [],        // subset listo para upsert
      fechaCsv: null,          // 'YYYY-MM-DD' detectada
      placasExistentes: new Set(),  // placas ya en tabla 'vehiculos'
      registrosExistentesEnFecha: 0, // cuántos ya hay en gps_km para esa fecha
      historialImports: [],    // últimas N fechas con conteos
    },
  },

  // ==================== INIT ====================
  async init() {
    Utils.log('Iniciando Configuración...');

    const profile = await Auth.requireAuth();
    if (!profile) return;

    if (profile.rol !== 'admin') {
      this.mostrarErrorAcceso();
      return;
    }

    this.state.profile = profile;
    document.getElementById('user-nombre-header').textContent = profile.nombre;

    document.getElementById('btn-back').addEventListener('click', () => {
      window.location.href = 'admin.html';
    });
    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

    this.bindEventos();
    await this.cargarTodo();
    this.mostrarContenido();
  },

  mostrarErrorAcceso() {
    document.getElementById('config-loading').hidden = true;
    document.getElementById('config-error').hidden = false;
    document.getElementById('config-error-msg').textContent =
      'Solo el administrador puede acceder a esta pantalla.';
  },

  mostrarContenido() {
    document.getElementById('config-loading').hidden = true;
    document.getElementById('config-content').hidden = false;
  },

  async cargarTodo() {
    try {
      await Promise.all([
        this.cargarCategorias(),
        this.cargarCatalogo(),
        this.cargarIntervalos(),
        this.cargarGrupos(),
        this.cargarUsuarios(),
        this.cargarHistorialKmGps(),  // tolerante a fallos (si la tabla aún no existe)
      ]);
      this.renderCatalogo();
      this.renderIntervalos();
      this.renderGrupos();
      this.renderUsuarios();
      this.renderHistorialKmGps();
    } catch (err) {
      Utils.log('Error cargando configuración:', err);
      alert('Error cargando datos: ' + (err.message || ''));
    }
  },

  // ==================== CATEGORÍAS ====================
  async cargarCategorias() {
    const { data, error } = await supabaseClient
      .from('categorias')
      .select('id, nombre, orden_visual, activa')
      .eq('activa', true)
      .order('orden_visual');
    if (error) throw error;
    this.state.categorias = data || [];

    // Poblar el select del modal
    const sel = document.getElementById('servicio-categoria');
    sel.innerHTML = this.state.categorias
      .map(c => `<option value="${c.id}">${Utils.escapeHtml(c.nombre)}</option>`)
      .join('');
  },

  // ==================== CATÁLOGO ====================
  async cargarCatalogo() {
    const { data, error } = await supabaseClient
      .from('catalogo_servicios')
      .select('id, nombre, categoria_id, tiempo_promedio_min, activo')
      .order('nombre');
    if (error) throw error;
    this.state.catalogo = data || [];
  },

  renderCatalogo() {
    const lista = document.getElementById('catalogo-list');
    const count = document.getElementById('catalogo-count');
    const q = this.state.busquedaCatalogo.trim().toLowerCase();

    let items = this.state.catalogo;
    if (q) items = items.filter(s => s.nombre.toLowerCase().includes(q));

    count.textContent = `${items.length} / ${this.state.catalogo.length}`;

    if (items.length === 0) {
      lista.innerHTML = '<p class="empty-state">Sin servicios que coincidan.</p>';
      return;
    }

    lista.innerHTML = items.map(s => {
      const cat = this.state.categorias.find(c => c.id === s.categoria_id);
      const catNombre = cat ? cat.nombre : '—';
      const tiempo = s.tiempo_promedio_min ? `${s.tiempo_promedio_min} min` : '—';
      const cls = s.activo ? '' : 'inactivo';

      return `
        <div class="config-row row-catalogo ${cls}">
          <div>
            <div class="row-titulo">${Utils.escapeHtml(s.nombre)}</div>
            <div class="row-meta">⏱ ${tiempo}</div>
          </div>
          <div class="row-meta">${Utils.escapeHtml(catNombre)}</div>
          <div class="row-actions">
            <span class="estado-pill ${s.activo ? 'activo' : 'inactivo'}">
              ${s.activo ? 'Activo' : 'Inactivo'}
            </span>
            <button class="btn-icon" data-action="edit-servicio" data-id="${s.id}">Editar</button>
            ${s.activo
              ? `<button class="btn-icon btn-icon-danger" data-action="toggle-servicio" data-id="${s.id}" data-to="false">Desactivar</button>`
              : `<button class="btn-icon btn-icon-success" data-action="toggle-servicio" data-id="${s.id}" data-to="true">Activar</button>`}
          </div>
        </div>
      `;
    }).join('');
  },

  abrirModalServicio(servicioId = null) {
    this.state.editando = servicioId
      ? { tipo: 'servicio', id: servicioId }
      : { tipo: 'servicio', id: null };

    const titulo = document.getElementById('modal-servicio-titulo');
    const nombreEl = document.getElementById('servicio-nombre');
    const catEl = document.getElementById('servicio-categoria');
    const tiempoEl = document.getElementById('servicio-tiempo');
    const errEl = document.getElementById('servicio-error');
    errEl.hidden = true;

    if (servicioId) {
      const s = this.state.catalogo.find(x => x.id === servicioId);
      if (!s) return;
      titulo.textContent = 'Editar servicio';
      nombreEl.value = s.nombre;
      catEl.value = String(s.categoria_id);
      tiempoEl.value = s.tiempo_promedio_min || '';
    } else {
      titulo.textContent = 'Nuevo servicio';
      nombreEl.value = '';
      catEl.selectedIndex = 0;
      tiempoEl.value = '';
    }

    document.getElementById('modal-servicio').hidden = false;
    setTimeout(() => nombreEl.focus(), 100);
  },

  async guardarServicio() {
    const nombre = document.getElementById('servicio-nombre').value.trim();
    const categoriaId = parseInt(document.getElementById('servicio-categoria').value, 10);
    const tiempoRaw = document.getElementById('servicio-tiempo').value.trim();
    const tiempo = tiempoRaw === '' ? null : parseInt(tiempoRaw, 10);
    const errEl = document.getElementById('servicio-error');

    if (!nombre) { errEl.textContent = 'El nombre es obligatorio.'; errEl.hidden = false; return; }
    if (isNaN(categoriaId)) { errEl.textContent = 'Selecciona una categoría.'; errEl.hidden = false; return; }
    if (tiempo !== null && (isNaN(tiempo) || tiempo < 1 || tiempo > 600)) {
      errEl.textContent = 'Tiempo inválido (1–600 min).'; errEl.hidden = false; return;
    }

    const btn = document.getElementById('btn-confirmar-servicio');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      const editId = this.state.editando?.id;
      if (editId) {
        const { error } = await supabaseClient
          .from('catalogo_servicios')
          .update({
            nombre,
            categoria_id: categoriaId,
            tiempo_promedio_min: tiempo,
          })
          .eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabaseClient
          .from('catalogo_servicios')
          .insert({
            nombre,
            categoria_id: categoriaId,
            tiempo_promedio_min: tiempo,
            activo: true,
          });
        if (error) throw error;
      }

      this.cerrarModales();
      await this.cargarCatalogo();
      this.renderCatalogo();
    } catch (err) {
      Utils.log('Error guardando servicio:', err);
      errEl.textContent = err.message || 'No se pudo guardar.';
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  },

  async toggleServicio(servicioId, activo) {
    if (!confirm(activo
      ? '¿Reactivar este servicio? Volverá a aparecer en nuevas órdenes.'
      : '¿Desactivar este servicio? Dejará de aparecer en nuevas órdenes (las históricas no se afectan).')) return;

    try {
      const { error } = await supabaseClient
        .from('catalogo_servicios')
        .update({ activo })
        .eq('id', servicioId);
      if (error) throw error;
      await this.cargarCatalogo();
      this.renderCatalogo();
    } catch (err) {
      Utils.log('Error toggle servicio:', err);
      alert('No se pudo cambiar el estado: ' + (err.message || ''));
    }
  },

  // ==================== INTERVALOS ====================
  async cargarIntervalos() {
    try {
      const { data, error } = await supabaseClient
        .from('intervalos_servicio')
        .select(`
          id, servicio_id, intervalo_km, intervalo_dias, activo,
          catalogo_servicios ( nombre )
        `)
        .order('servicio_id');
      if (error) throw error;
      this.state.intervalos = (data || []).map(i => ({
        ...i,
        servicio_nombre: i.catalogo_servicios?.nombre || `Servicio #${i.servicio_id}`,
      }));
    } catch (err) {
      Utils.log('Error cargando intervalos:', err);
      this.state.intervalos = [];
    }
  },

  renderIntervalos() {
    const lista = document.getElementById('intervalos-list');
    const count = document.getElementById('intervalos-count');
    const items = this.state.intervalos;
    count.textContent = items.length;

    if (items.length === 0) {
      lista.innerHTML = '<p class="empty-state">Sin intervalos configurados. ¿La tabla `intervalos_servicio` existe en BD?</p>';
      return;
    }

    lista.innerHTML = items.map(i => {
      const cls = i.activo ? '' : 'inactivo';
      const km = i.intervalo_km != null ? `${i.intervalo_km.toLocaleString('es-HN')} km` : '—';
      const dias = i.intervalo_dias != null ? `${i.intervalo_dias} días` : '—';
      return `
        <div class="config-row row-intervalo ${cls}">
          <div class="row-titulo">${Utils.escapeHtml(i.servicio_nombre)}</div>
          <div class="row-meta"><strong>KM:</strong> ${km}</div>
          <div class="row-meta"><strong>Tiempo:</strong> ${dias}</div>
          <div class="row-actions">
            <span class="estado-pill ${i.activo ? 'activo' : 'inactivo'}">
              ${i.activo ? 'Activo' : 'Inactivo'}
            </span>
            <button class="btn-icon" data-action="edit-intervalo" data-id="${i.id}">Editar</button>
            ${i.activo
              ? `<button class="btn-icon btn-icon-danger" data-action="toggle-intervalo" data-id="${i.id}" data-to="false">Desactivar</button>`
              : `<button class="btn-icon btn-icon-success" data-action="toggle-intervalo" data-id="${i.id}" data-to="true">Activar</button>`}
          </div>
        </div>
      `;
    }).join('');
  },

  abrirModalIntervalo(intervaloId) {
    const i = this.state.intervalos.find(x => x.id === intervaloId);
    if (!i) return;

    this.state.editando = { tipo: 'intervalo', id: intervaloId };

    document.getElementById('intervalo-servicio-nombre').textContent = i.servicio_nombre;
    document.getElementById('intervalo-km').value = i.intervalo_km != null ? i.intervalo_km : '';
    document.getElementById('intervalo-dias').value = i.intervalo_dias != null ? i.intervalo_dias : '';
    document.getElementById('intervalo-error').hidden = true;
    document.getElementById('modal-intervalo').hidden = false;
  },

  async guardarIntervalo() {
    const id = this.state.editando?.id;
    if (!id) return;

    const kmRaw = document.getElementById('intervalo-km').value.trim();
    const diasRaw = document.getElementById('intervalo-dias').value.trim();
    const km = kmRaw === '' ? null : parseInt(kmRaw, 10);
    const dias = diasRaw === '' ? null : parseInt(diasRaw, 10);
    const errEl = document.getElementById('intervalo-error');

    if (km === null && dias === null) {
      errEl.textContent = 'Al menos uno (km o días) debe tener valor.';
      errEl.hidden = false;
      return;
    }
    if (km !== null && (isNaN(km) || km < 0)) {
      errEl.textContent = 'KM inválido.';
      errEl.hidden = false;
      return;
    }
    if (dias !== null && (isNaN(dias) || dias < 0)) {
      errEl.textContent = 'Días inválido.';
      errEl.hidden = false;
      return;
    }

    const btn = document.getElementById('btn-confirmar-intervalo');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      const { error } = await supabaseClient
        .from('intervalos_servicio')
        .update({
          intervalo_km: km,
          intervalo_dias: dias,
          actualizado_en: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;

      this.cerrarModales();
      await this.cargarIntervalos();
      this.renderIntervalos();
    } catch (err) {
      Utils.log('Error guardando intervalo:', err);
      errEl.textContent = err.message || 'No se pudo guardar.';
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  },

  async toggleIntervalo(intervaloId, activo) {
    if (!confirm(activo
      ? '¿Reactivar este intervalo? Volverá a generar alertas.'
      : '¿Desactivar este intervalo? Dejará de generar alertas.')) return;

    try {
      const { error } = await supabaseClient
        .from('intervalos_servicio')
        .update({ activo, actualizado_en: new Date().toISOString() })
        .eq('id', intervaloId);
      if (error) throw error;
      await this.cargarIntervalos();
      this.renderIntervalos();
    } catch (err) {
      Utils.log('Error toggle intervalo:', err);
      alert('No se pudo cambiar el estado: ' + (err.message || ''));
    }
  },

  // ==================== GRUPOS WHATSAPP ====================
  async cargarGrupos() {
    try {
      const { data, error } = await supabaseClient
        .from('grupos_whatsapp')
        .select('id, codigo, nombre, invite_link, activo')
        .order('codigo');
      if (error) throw error;
      this.state.grupos = data || [];
    } catch (err) {
      Utils.log('Error cargando grupos:', err);
      this.state.grupos = [];
    }
  },

  renderGrupos() {
    const lista = document.getElementById('grupos-list');
    const count = document.getElementById('grupos-count');
    const items = this.state.grupos;
    count.textContent = items.length;

    if (items.length === 0) {
      lista.innerHTML = '<p class="empty-state">Sin grupos configurados. ¿La tabla `grupos_whatsapp` existe en BD?</p>';
      return;
    }

    lista.innerHTML = items.map(g => {
      const cls = g.activo ? '' : 'inactivo';
      return `
        <div class="config-row row-grupo ${cls}">
          <div>
            <div class="row-titulo">${Utils.escapeHtml(g.nombre)}</div>
            <div class="row-meta">código: <code>${Utils.escapeHtml(g.codigo)}</code></div>
          </div>
          <div class="row-link">${Utils.escapeHtml(g.invite_link)}</div>
          <div class="row-actions">
            <span class="estado-pill ${g.activo ? 'activo' : 'inactivo'}">
              ${g.activo ? 'Activo' : 'Inactivo'}
            </span>
            <button class="btn-icon" data-action="edit-grupo" data-id="${g.id}">Editar</button>
            ${g.activo
              ? `<button class="btn-icon btn-icon-danger" data-action="toggle-grupo" data-id="${g.id}" data-to="false">Desactivar</button>`
              : `<button class="btn-icon btn-icon-success" data-action="toggle-grupo" data-id="${g.id}" data-to="true">Activar</button>`}
          </div>
        </div>
      `;
    }).join('');
  },

  abrirModalGrupo(grupoId) {
    const g = this.state.grupos.find(x => x.id === grupoId);
    if (!g) return;

    this.state.editando = { tipo: 'grupo', id: grupoId };

    document.getElementById('grupo-codigo-display').textContent = `Código interno: ${g.codigo}`;
    document.getElementById('grupo-nombre').value = g.nombre;
    document.getElementById('grupo-link').value = g.invite_link;
    document.getElementById('grupo-error').hidden = true;
    document.getElementById('modal-grupo').hidden = false;
  },

  async guardarGrupo() {
    const id = this.state.editando?.id;
    if (!id) return;

    const nombre = document.getElementById('grupo-nombre').value.trim();
    const link = document.getElementById('grupo-link').value.trim();
    const errEl = document.getElementById('grupo-error');

    if (!nombre) { errEl.textContent = 'Nombre obligatorio.'; errEl.hidden = false; return; }
    if (!link) { errEl.textContent = 'Link obligatorio.'; errEl.hidden = false; return; }
    if (!link.startsWith('https://chat.whatsapp.com/')) {
      errEl.textContent = 'El link debe empezar con https://chat.whatsapp.com/';
      errEl.hidden = false;
      return;
    }

    const btn = document.getElementById('btn-confirmar-grupo');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      const { error } = await supabaseClient
        .from('grupos_whatsapp')
        .update({
          nombre,
          invite_link: link,
          actualizado_en: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;

      this.cerrarModales();
      await this.cargarGrupos();
      this.renderGrupos();
    } catch (err) {
      Utils.log('Error guardando grupo:', err);
      errEl.textContent = err.message || 'No se pudo guardar.';
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  },

  async toggleGrupo(grupoId, activo) {
    if (!confirm(activo
      ? '¿Reactivar este grupo? Los toasts volverán a usar este link.'
      : '¿Desactivar este grupo? Los toasts no podrán abrirlo.')) return;

    try {
      const { error } = await supabaseClient
        .from('grupos_whatsapp')
        .update({ activo, actualizado_en: new Date().toISOString() })
        .eq('id', grupoId);
      if (error) throw error;
      await this.cargarGrupos();
      this.renderGrupos();
    } catch (err) {
      Utils.log('Error toggle grupo:', err);
      alert('No se pudo cambiar el estado: ' + (err.message || ''));
    }
  },

  // ==================== EVENTOS GLOBALES ====================
  bindEventos() {
    // Toggle de secciones (collapsible)
    document.querySelectorAll('.card-header-clickable[data-section]').forEach(h => {
      h.addEventListener('click', () => {
        const sec = h.dataset.section;
        const body = document.getElementById(`${sec}-body`);
        const toggle = document.getElementById(`toggle-${sec}`);
        const isHidden = body.hidden;
        body.hidden = !isHidden;
        h.classList.toggle('collapsed', !isHidden);
        if (toggle) toggle.textContent = isHidden ? '▼' : '▶';
      });
    });

    // Búsqueda catálogo
    let debounce;
    document.getElementById('catalogo-search').addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.state.busquedaCatalogo = e.target.value;
        this.renderCatalogo();
      }, 200);
    });

    // Botón agregar servicio
    document.getElementById('btn-agregar-servicio').addEventListener('click', () => this.abrirModalServicio());

    // Modales: cancelar
    document.getElementById('btn-cancelar-servicio').addEventListener('click', () => this.cerrarModales());
    document.getElementById('btn-cancelar-intervalo').addEventListener('click', () => this.cerrarModales());
    document.getElementById('btn-cancelar-grupo').addEventListener('click', () => this.cerrarModales());
    const btnCancelarReset = document.getElementById('btn-cancelar-reset-pin');
    if (btnCancelarReset) btnCancelarReset.addEventListener('click', () => this.cerrarModales());

    // Modales: confirmar
    document.getElementById('btn-confirmar-servicio').addEventListener('click', () => this.guardarServicio());
    document.getElementById('btn-confirmar-intervalo').addEventListener('click', () => this.guardarIntervalo());
    document.getElementById('btn-confirmar-grupo').addEventListener('click', () => this.guardarGrupo());
    const btnConfirmarReset = document.getElementById('btn-confirmar-reset-pin');
    if (btnConfirmarReset) btnConfirmarReset.addEventListener('click', () => this.confirmarResetPin());

    // Filtrar inputs de PIN: solo dígitos
    ['reset-pin-input', 'reset-pin-confirm', 'crear-usuario-pin', 'crear-usuario-pin-confirm'].forEach(id => {
      const inp = document.getElementById(id);
      if (inp) {
        inp.addEventListener('input', (e) => {
          e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
        });
      }
    });

    // ============= MÓDULO CREAR USUARIO =============
    const btnCrearUsuario = document.getElementById('btn-crear-usuario');
    if (btnCrearUsuario) btnCrearUsuario.addEventListener('click', () => this.abrirModalCrearUsuario());

    const btnCancelarCrear = document.getElementById('btn-cancelar-crear-usuario');
    if (btnCancelarCrear) btnCancelarCrear.addEventListener('click', () => this.cerrarModales());

    const btnConfirmarCrear = document.getElementById('btn-confirmar-crear-usuario');
    if (btnConfirmarCrear) btnConfirmarCrear.addEventListener('click', () => this.confirmarCrearUsuario());

    // Código en mayúsculas mientras escribe
    const inputCodigoNuevo = document.getElementById('crear-usuario-codigo');
    if (inputCodigoNuevo) {
      inputCodigoNuevo.addEventListener('input', (e) => {
        const start = e.target.selectionStart;
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        e.target.setSelectionRange(start, start);
      });
    }

    // Mostrar/ocultar campo precio según el rol
    const selRolNuevo = document.getElementById('crear-usuario-rol');
    if (selRolNuevo) {
      selRolNuevo.addEventListener('change', () => this._togglePrecioCrearUsuario());
    }

    // ============= MÓDULO IMPORTAR KM (GPS) =============
    const btnSeleccionar = document.getElementById('btn-kmgps-seleccionar');
    const inputFile = document.getElementById('kmgps-file-input');
    const btnCancelar = document.getElementById('btn-kmgps-cancelar');
    const btnConfirmar = document.getElementById('btn-kmgps-confirmar');

    if (btnSeleccionar && inputFile) {
      btnSeleccionar.addEventListener('click', () => inputFile.click());
      inputFile.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) this.kmgpsArchivoSeleccionado(file);
      });
    }
    if (btnCancelar) btnCancelar.addEventListener('click', () => this.kmgpsCancelar());
    if (btnConfirmar) btnConfirmar.addEventListener('click', () => this.kmgpsConfirmarImportacion());

    // Click en backdrops cierra modales
    document.querySelectorAll('.modal-backdrop').forEach(b => {
      b.addEventListener('click', () => this.cerrarModales());
    });

    // Delegación: botones de acción dentro de las listas
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = parseInt(btn.dataset.id, 10);

      if (action === 'edit-servicio') this.abrirModalServicio(id);
      else if (action === 'toggle-servicio') this.toggleServicio(id, btn.dataset.to === 'true');
      else if (action === 'edit-intervalo') this.abrirModalIntervalo(id);
      else if (action === 'toggle-intervalo') this.toggleIntervalo(id, btn.dataset.to === 'true');
      else if (action === 'edit-grupo') this.abrirModalGrupo(id);
      else if (action === 'toggle-grupo') this.toggleGrupo(id, btn.dataset.to === 'true');
    });
  },

  cerrarModales() {
    document.getElementById('modal-servicio').hidden = true;
    document.getElementById('modal-intervalo').hidden = true;
    document.getElementById('modal-grupo').hidden = true;
    const modalReset = document.getElementById('modal-resetear-pin');
    if (modalReset) modalReset.hidden = true;
    const modalCrear = document.getElementById('modal-crear-usuario');
    if (modalCrear) modalCrear.hidden = true;
    this.state.editando = null;
    this.state.resetPinUsuario = null;
  },

  // ============================================================
  // ============= MÓDULO: USUARIOS =============================
  // ============================================================
  async cargarUsuarios() {
    const { data, error } = await supabaseClient
      .from('usuarios')
      .select('id, nombre, codigo, rol, activo, precio_hora')
      .order('rol', { ascending: true })
      .order('nombre', { ascending: true });
    if (error) throw error;
    this.state.usuarios = data || [];
  },

  renderUsuarios() {
    const list = document.getElementById('usuarios-list');
    const count = document.getElementById('usuarios-count');
    if (!list) return;

    const usuarios = this.state.usuarios || [];
    if (count) count.textContent = usuarios.length;

    if (usuarios.length === 0) {
      list.innerHTML = '<p class="empty-state">No hay usuarios registrados.</p>';
      return;
    }

    const callerId = this.state.profile.id;
    const rolBadge = (rol) => {
      const labels = { admin: 'Admin', jefe_pista: 'Jefe', tecnico: 'Técnico', motorista: 'Motorista' };
      return `<span class="usuario-rol-badge usuario-rol-${rol}">${labels[rol] || rol}</span>`;
    };

    list.innerHTML = usuarios.map(u => {
      const esYo = u.id === callerId;
      const inactivo = u.activo === false;
      const btnReset = esYo
        ? '<span class="usuario-row-yo" title="No podés resetear tu propio PIN desde aquí">— Eres tú —</span>'
        : `<button class="btn-secondary btn-mini" data-reset-pin data-uid="${Utils.escapeHtml(u.id)}" data-nombre="${Utils.escapeHtml(u.nombre)}" data-codigo="${Utils.escapeHtml(u.codigo || '')}">🔑 Resetear PIN</button>`;
      const esTecnico = u.rol === 'tecnico';
      const precioHoraHtml = esTecnico ? `
        <div class="usuario-precio-wrap">
          <label class="usuario-precio-label">L./hora</label>
          <input type="number" class="usuario-precio-input" min="0" step="0.01"
            placeholder="0.00"
            value="${u.precio_hora != null ? Number(u.precio_hora).toFixed(2) : ''}"
            data-uid="${Utils.escapeHtml(u.id)}" />
          <button class="btn-secondary btn-mini usuario-precio-btn" data-uid="${Utils.escapeHtml(u.id)}">💾</button>
        </div>` : '';

      return `
        <div class="usuario-row${inactivo ? ' usuario-row-inactivo' : ''}">
          <div class="usuario-row-info">
            <div class="usuario-row-nombre">
              ${Utils.escapeHtml(u.nombre)}
              ${rolBadge(u.rol)}
              ${inactivo ? '<span class="usuario-row-inactivo-tag">INACTIVO</span>' : ''}
            </div>
            <div class="usuario-row-codigo">${Utils.escapeHtml(u.codigo || '—')}</div>
          </div>
          ${precioHoraHtml}
          <div class="usuario-row-acciones">${btnReset}</div>
        </div>`;
    }).join('');

    // Bindear botones de reset
    list.querySelectorAll('[data-reset-pin]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.abrirModalResetPin({
          id: btn.dataset.uid,
          nombre: btn.dataset.nombre,
          codigo: btn.dataset.codigo,
        });
      });
    });

    // Bindear botones de guardar precio/hora
    list.querySelectorAll('.usuario-precio-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const input = list.querySelector(`.usuario-precio-input[data-uid="${uid}"]`);
        if (!input) return;
        const val = parseFloat(input.value);
        if (isNaN(val) || val < 0) { input.style.borderColor = '#f87171'; return; }
        input.style.borderColor = '';
        btn.disabled = true; btn.textContent = '⏳';
        const { error } = await supabaseClient
          .from('usuarios')
          .update({ precio_hora: val })
          .eq('id', uid);
        if (error) {
          btn.textContent = '❌'; setTimeout(() => { btn.textContent = '💾'; btn.disabled = false; }, 2000);
        } else {
          btn.textContent = '✓'; setTimeout(() => { btn.textContent = '💾'; btn.disabled = false; }, 1500);
          const u = this.state.usuarios.find(x => x.id === uid);
          if (u) u.precio_hora = val;
        }
      });
    });

    // Inyectar CSS si no existe
    if (!document.getElementById('cfg-precio-hora-css')) {
      const s = document.createElement('style');
      s.id = 'cfg-precio-hora-css';
      s.textContent = `
        .usuario-precio-wrap {
          display:flex;align-items:center;gap:6px;
          margin: 4px 0 0;
        }
        .usuario-precio-label {
          font-size:0.72rem;color:rgba(255,255,255,0.45);white-space:nowrap;
        }
        .usuario-precio-input {
          width:90px;padding:4px 8px;border-radius:6px;
          background:rgba(255,255,255,0.07);
          border:1px solid rgba(255,255,255,0.15);
          color:#e8f0fe;font-size:0.85rem;font-family:'Manrope',sans-serif;
          text-align:right;
        }
        .usuario-precio-input:focus { outline:none;border-color:#2f7fe0; }
        .usuario-precio-input::-webkit-inner-spin-button,
        .usuario-precio-input::-webkit-outer-spin-button { opacity:0.4; }
      `;
      document.head.appendChild(s);
    }
  },

  abrirModalResetPin(usuario) {
    this.state.resetPinUsuario = usuario;
    document.getElementById('reset-pin-usuario-nombre').textContent = usuario.nombre;
    document.getElementById('reset-pin-usuario-codigo').textContent = usuario.codigo
      ? `Código: ${usuario.codigo}`
      : '';
    document.getElementById('reset-pin-input').value = '';
    document.getElementById('reset-pin-confirm').value = '';
    const errEl = document.getElementById('reset-pin-error');
    if (errEl) errEl.hidden = true;

    const modal = document.getElementById('modal-resetear-pin');
    modal.hidden = false;
    setTimeout(() => document.getElementById('reset-pin-input').focus(), 100);
  },

  async confirmarResetPin() {
    const usuario = this.state.resetPinUsuario;
    if (!usuario) return;

    const pin = document.getElementById('reset-pin-input').value.trim();
    const pinConfirm = document.getElementById('reset-pin-confirm').value.trim();
    const errEl = document.getElementById('reset-pin-error');
    const btnConfirm = document.getElementById('btn-confirmar-reset-pin');

    const mostrarError = (msg) => {
      if (errEl) {
        errEl.textContent = msg;
        errEl.hidden = false;
      }
    };

    // Validaciones cliente
    if (pin.length !== 6 || !/^[0-9]{6}$/.test(pin)) {
      return mostrarError('El PIN debe ser exactamente 6 dígitos numéricos.');
    }
    if (pin !== pinConfirm) {
      return mostrarError('Los PINs no coinciden.');
    }

    // Loading state
    if (errEl) errEl.hidden = true;
    if (btnConfirm) {
      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Cambiando...';
    }

    try {
      const { data, error } = await supabaseClient.rpc('admin_resetear_pin', {
        target_user_id: usuario.id,
        nuevo_pin: pin,
      });

      if (error) throw error;
      if (data && data.ok === false) {
        throw new Error(data.mensaje || 'No se pudo cambiar el PIN');
      }

      this.cerrarModales();
      alert(`✅ PIN cambiado para ${usuario.nombre}.\nDecile el nuevo PIN en privado.`);
    } catch (err) {
      Utils.log('Error reseteando PIN:', err);
      mostrarError('Error: ' + (err.message || 'No se pudo cambiar el PIN'));
    } finally {
      if (btnConfirm) {
        btnConfirm.disabled = false;
        btnConfirm.textContent = 'Cambiar PIN';
      }
    }
  },

  // ----- Crear usuario: abrir modal -----
  abrirModalCrearUsuario() {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('crear-usuario-nombre', '');
    setVal('crear-usuario-codigo', '');
    setVal('crear-usuario-pin', '');
    setVal('crear-usuario-pin-confirm', '');
    setVal('crear-usuario-precio', '');
    const selRol = document.getElementById('crear-usuario-rol');
    if (selRol) selRol.value = 'tecnico';

    const errEl = document.getElementById('crear-usuario-error');
    if (errEl) errEl.hidden = true;

    this._togglePrecioCrearUsuario();

    const modal = document.getElementById('modal-crear-usuario');
    if (modal) modal.hidden = false;
    setTimeout(() => {
      const n = document.getElementById('crear-usuario-nombre');
      if (n) n.focus();
    }, 100);
  },

  // ----- Crear usuario: mostrar/ocultar campo precio según rol -----
  _togglePrecioCrearUsuario() {
    const selRol = document.getElementById('crear-usuario-rol');
    const precioField = document.getElementById('crear-usuario-precio-field');
    if (!selRol || !precioField) return;
    precioField.style.display = (selRol.value === 'tecnico') ? '' : 'none';
  },

  // ----- Crear usuario: validar y llamar RPC -----
  async confirmarCrearUsuario() {
    const errEl = document.getElementById('crear-usuario-error');
    const btn = document.getElementById('btn-confirmar-crear-usuario');

    const mostrarError = (msg) => {
      if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
    };

    const nombre = (document.getElementById('crear-usuario-nombre').value || '').trim();
    const codigo = (document.getElementById('crear-usuario-codigo').value || '').trim().toUpperCase();
    const rol = document.getElementById('crear-usuario-rol').value;
    const pin = (document.getElementById('crear-usuario-pin').value || '').trim();
    const pinConfirm = (document.getElementById('crear-usuario-pin-confirm').value || '').trim();
    const precioRaw = (document.getElementById('crear-usuario-precio').value || '').trim();

    // Validaciones cliente
    if (!nombre) return mostrarError('El nombre es obligatorio.');
    if (!/^[A-Z][0-9]{5}$/.test(codigo)) {
      return mostrarError('El código debe ser una letra seguida de 5 dígitos (ej: A03404).');
    }
    if (!['tecnico', 'jefe_pista', 'admin'].includes(rol)) {
      return mostrarError('Selecciona un rol válido.');
    }
    if (pin.length !== 6 || !/^[0-9]{6}$/.test(pin)) {
      return mostrarError('El PIN debe ser exactamente 6 dígitos numéricos.');
    }
    if (pin !== pinConfirm) {
      return mostrarError('Los PINs no coinciden.');
    }

    let precio = null;
    if (rol === 'tecnico' && precioRaw !== '') {
      precio = parseFloat(precioRaw);
      if (isNaN(precio) || precio < 0) {
        return mostrarError('Precio por hora inválido.');
      }
    }

    // Loading state
    if (errEl) errEl.hidden = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Creando...'; }

    try {
      const { data, error } = await supabaseClient.rpc('admin_crear_usuario', {
        p_nombre: nombre,
        p_codigo: codigo,
        p_rol: rol,
        p_pin: pin,
        p_precio_hora: precio,
      });

      if (error) throw error;
      if (data && data.ok === false) {
        throw new Error(data.mensaje || 'No se pudo crear el usuario');
      }

      this.cerrarModales();
      alert(`✅ Usuario creado: ${nombre} (${codigo}).\nDecíle su PIN en privado.`);

      // Refrescar lista de usuarios
      await this.cargarUsuarios();
      this.renderUsuarios();
    } catch (err) {
      Utils.log('Error creando usuario:', err);
      mostrarError('Error: ' + (err.message || 'No se pudo crear el usuario'));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Crear usuario'; }
    }
  },

  // ============================================================
  // ============= MÓDULO: IMPORTAR KM (GPS) ====================
  // ============================================================
  // Sube un .csv del RPA con columnas Fecha_procesado, Vehiculo, kilometraje
  // (kilometraje = metros recorridos en el día). Hace upsert a tabla gps_km
  // con UNIQUE(placa, fecha) — re-subir el mismo día reemplaza.

  // ----- Cargar el historial de imports (últimas 30 fechas distintas) -----
  async cargarHistorialKmGps() {
    try {
      const { data, error } = await supabaseClient
        .from('gps_km')
        .select('fecha, creado_en, ingresado_por')
        .order('fecha', { ascending: false })
        .limit(2000);  // suficiente para reconstruir histórico

      if (error) {
        // Si la tabla no existe aún, no romper la pantalla.
        Utils.log('cargarHistorialKmGps: tabla no disponible o error:', error.message);
        this.state.kmgps.historialImports = [];
        return;
      }

      // Agrupar por fecha
      const porFecha = new Map();
      (data || []).forEach(r => {
        if (!porFecha.has(r.fecha)) {
          porFecha.set(r.fecha, { fecha: r.fecha, count: 0, ultimoSubido: null });
        }
        const g = porFecha.get(r.fecha);
        g.count += 1;
        const subTs = r.creado_en ? new Date(r.creado_en).getTime() : 0;
        if (!g.ultimoSubido || subTs > new Date(g.ultimoSubido).getTime()) {
          g.ultimoSubido = r.creado_en;
        }
      });

      const lista = Array.from(porFecha.values())
        .sort((a, b) => b.fecha.localeCompare(a.fecha))
        .slice(0, 10);

      this.state.kmgps.historialImports = lista;
    } catch (err) {
      Utils.log('cargarHistorialKmGps error:', err);
      this.state.kmgps.historialImports = [];
    }
  },

  renderHistorialKmGps() {
    const cont = document.getElementById('kmgps-historial-list');
    const badgeUltima = document.getElementById('kmgps-ultima-fecha');
    const lista = this.state.kmgps.historialImports || [];

    if (lista.length === 0) {
      if (cont) cont.innerHTML = '<p class="empty-state" style="padding: 8px 0; font-size: 0.85rem;">Aún no hay imports.</p>';
      if (badgeUltima) badgeUltima.textContent = '—';
      return;
    }

    if (badgeUltima) badgeUltima.textContent = `Último: ${this._fmtFecha(lista[0].fecha)}`;
    if (!cont) return;

    cont.innerHTML = lista.map(r => `
      <div class="kmgps-historial-row">
        <div class="kmgps-historial-fecha">${this._fmtFecha(r.fecha)}</div>
        <div class="kmgps-historial-meta">${r.ultimoSubido ? 'Subido ' + this._fmtFechaHora(r.ultimoSubido) : ''}</div>
        <div class="kmgps-historial-count">${r.count} veh.</div>
      </div>
    `).join('');
  },

  // ----- Archivo seleccionado: leer y parsear -----
  kmgpsArchivoSeleccionado(file) {
    this.state.kmgps.archivo = file;
    document.getElementById('kmgps-archivo-nombre').textContent = file.name;

    // Reset UI
    document.getElementById('kmgps-resultado').hidden = true;
    document.getElementById('kmgps-progress').hidden = true;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const texto = String(e.target.result || '');
        this.kmgpsParsearCsv(texto);
      } catch (err) {
        Utils.log('Error parseando CSV:', err);
        alert('Error leyendo el CSV: ' + (err.message || ''));
      }
    };
    reader.onerror = () => alert('No se pudo leer el archivo.');
    reader.readAsText(file, 'utf-8');
  },

  kmgpsCancelar() {
    this.state.kmgps.archivo = null;
    this.state.kmgps.filasParseadas = [];
    this.state.kmgps.filasValidas = [];
    this.state.kmgps.fechaCsv = null;
    document.getElementById('kmgps-file-input').value = '';
    document.getElementById('kmgps-archivo-nombre').textContent = '';
    document.getElementById('kmgps-preview').hidden = true;
    document.getElementById('kmgps-resultado').hidden = true;
    document.getElementById('kmgps-progress').hidden = true;
  },

  // ----- Parser CSV (sin librerías) -----
  // Espera columnas: Fecha_procesado, Vehiculo, kilometraje
  // Tolera \r\n, \n, BOM al inicio, líneas vacías.
  async kmgpsParsearCsv(texto) {
    // Quitar BOM si existe
    if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);

    const lineas = texto.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lineas.length < 2) {
      alert('El archivo parece vacío o no tiene datos.');
      return;
    }

    // Header
    const header = this._csvSplitLine(lineas[0]).map(h => h.trim().toLowerCase());
    const idxFecha   = header.findIndex(h => h === 'fecha_procesado' || h === 'fecha');
    const idxVehic   = header.findIndex(h => h === 'vehiculo' || h === 'vehículo' || h === 'placa');
    const idxKm      = header.findIndex(h => h === 'kilometraje' || h === 'metros' || h === 'km');

    if (idxFecha < 0 || idxVehic < 0 || idxKm < 0) {
      alert('El CSV no tiene las columnas esperadas: Fecha_procesado, Vehiculo, kilometraje.\nDetectadas: ' + header.join(', '));
      return;
    }

    // Cargar set de placas existentes en tabla 'vehiculos' para marcar las nuevas
    const placasExistentes = await this._cargarPlacasExistentes();
    this.state.kmgps.placasExistentes = placasExistentes;

    // Parsear filas
    const filas = [];
    let fechaDetectada = null;
    for (let i = 1; i < lineas.length; i++) {
      const cols = this._csvSplitLine(lineas[i]);
      if (cols.length === 0) continue;

      const fechaRaw  = (cols[idxFecha] || '').trim();
      const vehicRaw  = (cols[idxVehic] || '').trim();
      const kmRaw     = (cols[idxKm]    || '').trim();

      const fecha = this._normalizarFecha(fechaRaw);
      const placa = this._normalizarPlaca(vehicRaw);
      const metros = this._parsearMetros(kmRaw);

      const errores = [];
      if (!fecha) errores.push('fecha inválida');
      if (!placa) errores.push('placa vacía');
      if (metros === null) errores.push('km no numérico');
      if (metros !== null && metros < 0) errores.push('km negativo');

      if (fecha && !fechaDetectada) fechaDetectada = fecha;

      const km = metros !== null ? +(metros / 1000).toFixed(3) : null;

      let estado = 'ok';
      if (errores.length > 0) estado = 'error';
      // < 2 km en un día de trabajo: claramente no se movió (incluye el "1001"
      // del RPA y otros casos similares).
      else if (metros !== null && metros < 2000) estado = 'sinmov';
      else if (placa && !placasExistentes.has(placa)) estado = 'nueva';

      filas.push({
        linea: i + 1,
        fechaRaw, vehicRaw, kmRaw,
        fecha, placa, metros, km,
        estado,           // 'ok' | 'error' | 'sinmov' | 'nueva'
        errores,
      });
    }

    this.state.kmgps.filasParseadas = filas;
    this.state.kmgps.fechaCsv = fechaDetectada;
    this.state.kmgps.filasValidas = filas.filter(f => f.estado !== 'error');

    // Verificar si ya hay registros para esa fecha
    let existentes = 0;
    if (fechaDetectada) {
      try {
        const { count, error } = await supabaseClient
          .from('gps_km')
          .select('*', { count: 'exact', head: true })
          .eq('fecha', fechaDetectada);
        if (!error) existentes = count || 0;
      } catch (e) {
        Utils.log('No se pudo verificar registros existentes:', e);
      }
    }
    this.state.kmgps.registrosExistentesEnFecha = existentes;

    this.kmgpsRenderPreview();
  },

  _csvSplitLine(linea) {
    // Parser CSV simple: maneja comillas y comas dentro de comillas.
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (c === '"') {
        if (inQuotes && linea[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        result.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur);
    return result;
  },

  _normalizarFecha(str) {
    if (!str) return null;
    // Acepta YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY
    const s = String(str).trim();
    let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    return null;
  },

  _normalizarPlaca(str) {
    if (!str) return null;
    // Comprimir múltiples espacios a uno, trim, mayúsculas.
    return String(str).trim().toUpperCase().replace(/\s+/g, ' ');
  },

  _parsearMetros(str) {
    if (str === null || str === undefined) return null;
    let s = String(str).trim();
    if (s === '') return null;
    // El RPA usa el punto como separador de miles: "129.066" = 129066 metros.
    // Quitamos TODOS los puntos. Si por error usaran coma como decimal, también la quitamos.
    s = s.replace(/\./g, '').replace(/,/g, '');
    if (!/^\d+$/.test(s)) return null;
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  },

  async _cargarPlacasExistentes() {
    try {
      // Tabla 'vehiculos' usa la placa como PK o como columna única, según veo en
      // tu modelo. Cargamos todas las placas para marcar las "nuevas" del CSV.
      const set = new Set();
      const { data, error } = await supabaseClient
        .from('vehiculos')
        .select('placa');
      if (!error && Array.isArray(data)) {
        data.forEach(v => v.placa && set.add(this._normalizarPlaca(v.placa)));
      } else if (error) {
        Utils.log('No se pudo leer tabla vehiculos:', error.message);
      }
      return set;
    } catch (e) {
      Utils.log('Error cargando placas existentes:', e);
      return new Set();
    }
  },

  // ----- Render preview -----
  kmgpsRenderPreview() {
    const filas = this.state.kmgps.filasParseadas;
    const validas = this.state.kmgps.filasValidas;
    const errores = filas.filter(f => f.estado === 'error');
    const sinMov = filas.filter(f => f.estado === 'sinmov');
    const nuevas = filas.filter(f => f.estado === 'nueva');
    const fecha = this.state.kmgps.fechaCsv;

    document.getElementById('kmgps-preview').hidden = false;

    document.getElementById('kmgps-stat-fecha').textContent   = fecha ? this._fmtFecha(fecha) : '—';
    document.getElementById('kmgps-stat-filas').textContent   = filas.length;
    document.getElementById('kmgps-stat-validas').textContent = validas.length;
    document.getElementById('kmgps-stat-errores').textContent = errores.length;
    document.getElementById('kmgps-stat-sinmov').textContent  = sinMov.length;
    document.getElementById('kmgps-stat-nuevas').textContent  = nuevas.length;

    // Aviso de fecha existente
    const aviso = document.getElementById('kmgps-aviso-existente');
    const exist = this.state.kmgps.registrosExistentesEnFecha;
    if (exist > 0) {
      document.getElementById('kmgps-existente-count').textContent = exist;
      aviso.hidden = false;
    } else {
      aviso.hidden = true;
    }

    // Tabla preview (primeras 10 filas, priorizando errores si hay)
    const filasMostrar = errores.length > 0
      ? [...errores.slice(0, 5), ...validas.slice(0, 10 - Math.min(5, errores.length))]
      : filas.slice(0, 10);

    const tbody = document.getElementById('kmgps-tabla-body');
    tbody.innerHTML = filasMostrar.map(f => {
      const rowCls = f.estado === 'error' ? 'kmgps-row-error'
                  : f.estado === 'sinmov' ? 'kmgps-row-sinmov'
                  : f.estado === 'nueva'  ? 'kmgps-row-nueva' : '';
      const badge = this._kmgpsBadge(f);
      return `
        <tr class="${rowCls}">
          <td class="kmgps-td-placa">${Utils.escapeHtml(f.placa || f.vehicRaw || '—')}</td>
          <td>${Utils.escapeHtml(f.fecha || f.fechaRaw || '—')}</td>
          <td class="kmgps-td-num">${f.metros !== null ? f.metros.toLocaleString() : Utils.escapeHtml(f.kmRaw)}</td>
          <td class="kmgps-td-num">${f.km !== null ? f.km.toFixed(3) : '—'}</td>
          <td>${badge}</td>
        </tr>
      `;
    }).join('');

    // Lista de errores si hay
    const errCont = document.getElementById('kmgps-errores-lista');
    if (errores.length > 0) {
      errCont.hidden = false;
      errCont.innerHTML = `
        <strong>${errores.length} fila(s) con error</strong> (no se importarán):
        ${errores.slice(0, 50).map(e => `
          <div class="kmgps-error-item">
            Línea ${e.linea}: ${Utils.escapeHtml(e.errores.join(', '))} —
            <code>${Utils.escapeHtml(e.fechaRaw)} | ${Utils.escapeHtml(e.vehicRaw)} | ${Utils.escapeHtml(e.kmRaw)}</code>
          </div>
        `).join('')}
        ${errores.length > 50 ? `<div class="kmgps-error-item">... y ${errores.length - 50} más</div>` : ''}
      `;
    } else {
      errCont.hidden = true;
    }

    // Habilitar/deshabilitar botón confirmar
    const btnConfirmar = document.getElementById('btn-kmgps-confirmar');
    if (validas.length === 0) {
      btnConfirmar.disabled = true;
      btnConfirmar.textContent = '✕ No hay filas válidas';
    } else {
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = `✓ Importar ${validas.length} registro${validas.length === 1 ? '' : 's'}`;
    }
  },

  _kmgpsBadge(f) {
    if (f.estado === 'error')  return '<span class="kmgps-badge kmgps-badge-error">Error</span>';
    if (f.estado === 'sinmov') return '<span class="kmgps-badge kmgps-badge-warn">Sin moverse</span>';
    if (f.estado === 'nueva')  return '<span class="kmgps-badge kmgps-badge-info">Placa nueva</span>';
    return '<span class="kmgps-badge kmgps-badge-ok">OK</span>';
  },

  // ----- Confirmar e insertar (upsert por placa+fecha) -----
  async kmgpsConfirmarImportacion() {
    const validas = this.state.kmgps.filasValidas;
    if (!validas || validas.length === 0) return;

    const btnConfirmar = document.getElementById('btn-kmgps-confirmar');
    const btnCancelar  = document.getElementById('btn-kmgps-cancelar');
    const progress     = document.getElementById('kmgps-progress');
    const progressFill = document.getElementById('kmgps-progress-fill');
    const progressText = document.getElementById('kmgps-progress-text');
    const resultado    = document.getElementById('kmgps-resultado');

    btnConfirmar.disabled = true;
    btnCancelar.disabled  = true;
    progress.hidden = false;
    resultado.hidden = true;
    progressFill.style.width = '0%';
    progressText.textContent = `Importando 0 / ${validas.length}...`;

    // Construir registros para upsert. Procesar en chunks de 200.
    // Schema real: placa, fecha, metros_registrado, fuente (ENUM fuente_km), ingresado_por, creado_en
    const subidoPor = this.state.profile && this.state.profile.id ? this.state.profile.id : null;
    const registros = validas.map(f => ({
      placa: f.placa,
      fecha: f.fecha,
      metros_registrado: f.metros,
      fuente: 'rpa_csv',
      ingresado_por: subidoPor,
    }));

    const CHUNK = 200;
    let insertados = 0;
    let fallos = 0;
    const erroresMsg = [];

    // Helper: intenta upsert con los campos dados; si falla por columna inexistente
    // o por valor de ENUM no aceptado, reintenta sin 'fuente'; si aún falla, con
    // solo los esenciales (placa, fecha, metros_registrado).
    const upsertConFallback = async (registrosCompletos) => {
      // Intento 1: con todos los campos
      const r1 = await supabaseClient
        .from('gps_km')
        .upsert(registrosCompletos, { onConflict: 'placa,fecha' });
      if (!r1.error) return { error: null, modo: 'completo' };

      const msg1 = (r1.error.message || '').toLowerCase();
      const recoverable = msg1.includes('column') ||
                          msg1.includes('schema cache') ||
                          msg1.includes('could not find') ||
                          msg1.includes('enum') ||
                          msg1.includes('invalid input value');
      if (!recoverable) return { error: r1.error, modo: 'completo' };

      // Intento 2: sin 'fuente' (por si el ENUM rechazó 'rpa_csv')
      const sinFuente = registrosCompletos.map(r => ({
        placa: r.placa,
        fecha: r.fecha,
        metros_registrado: r.metros_registrado,
        ingresado_por: r.ingresado_por,
      }));
      const r2 = await supabaseClient
        .from('gps_km')
        .upsert(sinFuente, { onConflict: 'placa,fecha' });
      if (!r2.error) return { error: null, modo: 'sin_fuente' };

      const msg2 = (r2.error.message || '').toLowerCase();
      const recoverable2 = msg2.includes('column') ||
                           msg2.includes('schema cache') ||
                           msg2.includes('could not find');
      if (!recoverable2) return { error: r2.error, modo: 'sin_fuente' };

      // Intento 3: solo campos esenciales
      const minimos = registrosCompletos.map(r => ({
        placa: r.placa,
        fecha: r.fecha,
        metros_registrado: r.metros_registrado,
      }));
      const r3 = await supabaseClient
        .from('gps_km')
        .upsert(minimos, { onConflict: 'placa,fecha' });
      return { error: r3.error, modo: 'minimo' };
    };

    let modoUsado = 'completo';

    try {
      for (let i = 0; i < registros.length; i += CHUNK) {
        const slice = registros.slice(i, i + CHUNK);
        const { error, modo } = await upsertConFallback(slice);
        // Trackear el modo más restrictivo usado
        if (modo === 'minimo') modoUsado = 'minimo';
        else if (modo === 'sin_fuente' && modoUsado === 'completo') modoUsado = 'sin_fuente';

        if (error) {
          fallos += slice.length;
          erroresMsg.push(error.message || 'error desconocido');
          Utils.log('Error en chunk:', error);
        } else {
          insertados += slice.length;
        }

        const done = Math.min(i + CHUNK, registros.length);
        progressFill.style.width = `${Math.round((done / registros.length) * 100)}%`;
        progressText.textContent = `Importando ${done} / ${registros.length}...`;
      }

      // Resultado final
      progress.hidden = true;
      resultado.hidden = false;

      if (fallos === 0) {
        resultado.className = 'kmgps-resultado kmgps-resultado-ok';
        let aviso = '';
        if (modoUsado === 'sin_fuente') {
          aviso = `<br><small style="color: var(--text-muted);">⚠️ El ENUM <code>fuente_km</code> no aceptó el valor <code>'rpa_csv'</code>. Se guardó sin la columna fuente. Avisame qué valores acepta el ENUM y lo ajusto.</small>`;
        } else if (modoUsado === 'minimo') {
          aviso = `<br><small style="color: var(--text-muted);">⚠️ Se guardó solo placa, fecha y metros. Si quieres también registrar usuario y fuente, mandame el detalle del schema y lo ajusto.</small>`;
        }
        resultado.innerHTML = `
          ✅ <strong>Importación exitosa.</strong><br>
          ${insertados} registro${insertados === 1 ? '' : 's'} guardado${insertados === 1 ? '' : 's'} en gps_km
          para la fecha <strong>${this._fmtFecha(this.state.kmgps.fechaCsv)}</strong>.${aviso}
        `;
      } else if (insertados > 0) {
        resultado.className = 'kmgps-resultado kmgps-resultado-error';
        resultado.innerHTML = `
          ⚠️ <strong>Importación parcial.</strong><br>
          OK: ${insertados} · Fallos: ${fallos}<br>
          <small>${Utils.escapeHtml(erroresMsg.slice(0, 3).join(' · '))}</small>
        `;
      } else {
        resultado.className = 'kmgps-resultado kmgps-resultado-error';
        resultado.innerHTML = `
          ❌ <strong>No se pudo importar.</strong><br>
          <small>${Utils.escapeHtml(erroresMsg.slice(0, 3).join(' · '))}</small><br>
          <small style="color: var(--text-muted);">¿La tabla <code>gps_km</code> existe y tu usuario tiene permisos?</small>
        `;
      }

      // Refrescar historial
      await this.cargarHistorialKmGps();
      this.renderHistorialKmGps();

      // Limpiar selección si fue 100% exitoso
      if (fallos === 0) {
        setTimeout(() => this.kmgpsCancelar(), 100);
      }
    } catch (err) {
      Utils.log('Error en importación masiva:', err);
      progress.hidden = true;
      resultado.hidden = false;
      resultado.className = 'kmgps-resultado kmgps-resultado-error';
      resultado.innerHTML = `❌ <strong>Error:</strong> ${Utils.escapeHtml(err.message || String(err))}`;
    } finally {
      btnConfirmar.disabled = false;
      btnCancelar.disabled  = false;
    }
  },

  // ----- Helpers de formato -----
  _fmtFecha(iso) {
    if (!iso) return '—';
    const partes = String(iso).split('-');
    if (partes.length !== 3) return iso;
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  },

  _fmtFechaHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return `${dd}/${mm}/${yy} ${hh}:${mi}`;
  },
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    console.error('Supabase no inicializado');
    return;
  }
  Configuracion.init();
});
