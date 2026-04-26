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
    busquedaCatalogo: '',
    seccionExpandida: 'catalogo',  // catalogo | intervalos | grupos
    editando: null,  // { tipo, id }
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
      ]);
      this.renderCatalogo();
      this.renderIntervalos();
      this.renderGrupos();
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

    // Modales: confirmar
    document.getElementById('btn-confirmar-servicio').addEventListener('click', () => this.guardarServicio());
    document.getElementById('btn-confirmar-intervalo').addEventListener('click', () => this.guardarIntervalo());
    document.getElementById('btn-confirmar-grupo').addEventListener('click', () => this.guardarGrupo());

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
    this.state.editando = null;
  },
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    console.error('Supabase no inicializado');
    return;
  }
  Configuracion.init();
});
