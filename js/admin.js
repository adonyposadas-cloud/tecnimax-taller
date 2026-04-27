/**
 * admin.js — Tablero del Admin (Fase 3c)
 *
 * Secciones:
 *  1. KPIs en vivo (vehículos en taller, en proceso, pausados, ingresos hoy, completados, tiempo prom.)
 *  2. Alertas de servicios sospechosos (prominentes)
 *  3. Tablero de técnicos en vivo (estado de cada uno)
 *  4. Productividad por técnico (en el rango)
 *  5. Cancelaciones (en el rango)
 *
 * Selector de rango: Hoy / Esta semana / Este mes
 *
 * Realtime: ordenes, servicios_orden, historial_pausas, cancelaciones_orden
 */

const Admin = {

  state: {
    profile: null,
    rango: 'hoy',  // 'hoy' | 'semana' | 'mes'
    fechaDesde: null,
    fechaHasta: null,

    ordenes: [],
    servicios: [],
    pausas: [],
    cancelaciones: [],
    usuarios: [],
    serviciosCatalogo: [],
    alertasMtto: [],  // Alertas de mantenimiento KM (Fase 4b)

    realtimeChannel: null,
    pollingInterval: null,
    cronometros: {},  // { tecnicoId_servicioId: intervalId }
    cronometrosPausa: {},  // { servicioId: intervalId } - cronómetros de pausas en admin
    tecnicosExpandidos: new Set(),  // ids de técnicos con productividad expandida
  },

  // ==================== INIT ====================
  async init() {
    Utils.log('Iniciando panel admin...');

    const profile = await Auth.requireAuth();
    if (!profile) return;

    if (!['admin', 'jefe_pista'].includes(profile.rol)) {
      alert('No tienes permisos para ver este panel.');
      window.location.href = 'tecnico.html';
      return;
    }

    this.state.profile = profile;
    document.getElementById('user-nombre-header').textContent = profile.nombre || 'Administración';
    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

    this.calcularRango();
    this.actualizarRangoInfo();
    this.bindEventos();

    await this.cargarTodo();
    this.activarRealtime();
  },

  bindEventos() {
    document.querySelectorAll('.rango-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const r = tab.dataset.rango;
        if (r === this.state.rango) return;

        document.querySelectorAll('.rango-tab').forEach(t => t.classList.remove('rango-active'));
        tab.classList.add('rango-active');
        this.state.rango = r;
        this.calcularRango();
        this.actualizarRangoInfo();
        this.cargarTodo();
      });
    });

    document.getElementById('btn-toggle-alertas').addEventListener('click', () => {
      const lista = document.getElementById('alerta-lista');
      const btn = document.getElementById('btn-toggle-alertas');
      if (lista.hidden) {
        lista.hidden = false;
        btn.textContent = 'Ocultar';
      } else {
        lista.hidden = true;
        btn.textContent = 'Ver';
      }
    });

    // KPIs cliqueables (excepto "Tiempo promedio" que no lleva detalle)
    document.querySelectorAll('.kpi-card[data-kpi]').forEach(card => {
      card.addEventListener('click', () => {
        this.abrirKpiModal(card.dataset.kpi);
      });
    });

    // Cerrar KPI modal
    document.getElementById('kpi-modal-close').addEventListener('click', () => this.cerrarKpiModal());
    document.getElementById('kpi-modal-backdrop').addEventListener('click', () => this.cerrarKpiModal());

    // Esc cierra modales
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.cerrarKpiModal();
      }
    });

    // Refresh al volver a la pestaña (visibilitychange)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        Utils.log('Pestaña visible, refrescando datos...');
        this.cargarTodo();
      }
    });
  },

  // ==================== RANGOS ====================
  calcularRango() {
    const ahora = new Date();
    const desde = new Date(ahora);

    if (this.state.rango === 'hoy') {
      desde.setHours(0, 0, 0, 0);
    } else if (this.state.rango === 'semana') {
      // Lunes 00:00 de esta semana
      const diaSemana = desde.getDay();  // 0=domingo, 1=lunes...
      const diff = diaSemana === 0 ? 6 : diaSemana - 1;
      desde.setDate(desde.getDate() - diff);
      desde.setHours(0, 0, 0, 0);
    } else if (this.state.rango === 'mes') {
      desde.setDate(1);
      desde.setHours(0, 0, 0, 0);
    }

    this.state.fechaDesde = desde.toISOString();
    this.state.fechaHasta = new Date().toISOString();

    // Labels en las secciones
    const labels = { hoy: 'hoy', semana: 'esta semana', mes: 'este mes' };
    document.getElementById('prod-rango-label').textContent = labels[this.state.rango];
    document.getElementById('canc-rango-label').textContent = labels[this.state.rango];
  },

  actualizarRangoInfo() {
    const desde = new Date(this.state.fechaDesde);
    const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    document.getElementById('rango-info').textContent = `Desde ${fmt(desde)}`;
  },

  // ==================== CARGA DE DATOS ====================
  async cargarTodo() {
    try {
      // Recalcular rango antes de cargar para que fechaHasta refleje el "ahora" real.
      // Sin esto, el polling y visibilitychange usan una fechaHasta congelada al
      // momento de cargar la página, lo que hace que servicios completados después
      // de ese instante no entren en KPIs ni Productividad hasta cambiar de pestaña.
      this.calcularRango();
      this.actualizarRangoInfo();

      await Promise.all([
        this.cargarCatalogo(),
        this.cargarUsuarios(),
        this.cargarOrdenes(),
        this.cargarServicios(),
        this.cargarPausas(),
        this.cargarCancelaciones(),
        this.cargarAlertasMtto(),
      ]);

      this.renderKPIs();
      this.renderAlertas();
      this.renderTecnicos();
      this.renderProductividad();
      this.renderCancelaciones();
      this.renderAlertasMttoKpi();
    } catch (err) {
      Utils.log('Error cargando todo:', err);
    }
  },

  async cargarCatalogo() {
    const { data, error } = await supabaseClient
      .from('catalogo_servicios')
      .select('id, nombre, tiempo_promedio_min');
    if (error) throw error;
    this.state.serviciosCatalogo = data || [];
  },

  async cargarUsuarios() {
    const { data, error } = await supabaseClient
      .from('usuarios')
      .select('id, nombre, codigo, rol, activo')
      .eq('activo', true);
    if (error) throw error;
    this.state.usuarios = data || [];
  },

  async cargarOrdenes() {
    // Cargamos todas las órdenes (para KPIs en taller que son live)
    // Y filtramos por rango para los counts del rango
    const { data, error } = await supabaseClient
      .from('ordenes')
      .select('num_orden, placa, prioridad, estado, motivo, creada_en, cerrada_en, creada_por');
    if (error) throw error;
    this.state.ordenes = data || [];
  },

  async cargarServicios() {
    const { data, error } = await supabaseClient
      .from('servicios_orden')
      .select('id, num_orden, servicio_id, estado, tecnico_id, hora_inicio, hora_fin, tiempo_real_min, tiempo_asignado_min, sospechoso');
    if (error) throw error;
    this.state.servicios = data || [];
  },

  async cargarPausas() {
    const { data, error } = await supabaseClient
      .from('historial_pausas')
      .select('id, servicio_orden_id, tecnico_id, motivo, hora_pausa, hora_reanudacion');
    if (error) throw error;
    this.state.pausas = data || [];
  },

  async cargarCancelaciones() {
    const { data, error } = await supabaseClient
      .from('cancelaciones_orden')
      .select('id, num_orden, motivo, cancelada_por, cancelada_en')
      .gte('cancelada_en', this.state.fechaDesde)
      .order('cancelada_en', { ascending: false });
    if (error) throw error;
    this.state.cancelaciones = data || [];
  },

  async cargarAlertasMtto() {
    try {
      const { data, error } = await supabaseClient.rpc('f_alertas_flota');
      if (error) throw error;
      this.state.alertasMtto = data || [];
    } catch (err) {
      Utils.log('Error cargando alertas mtto (puede ser BD vieja):', err);
      this.state.alertasMtto = [];
    }
  },

  renderAlertasMttoKpi() {
    const card = document.getElementById('kpi-card-alertas-mtto');
    const valEl = document.getElementById('kpi-alertas-mtto');
    const hintEl = document.getElementById('kpi-alertas-mtto-hint');
    if (!card || !valEl) return;

    const alertas = this.state.alertasMtto || [];
    if (alertas.length === 0) {
      card.hidden = true;
      return;
    }

    const vencidas = alertas.filter(a => a.estado === 'vencido').length;
    const proximas = alertas.filter(a => a.estado === 'proximo').length;

    valEl.textContent = vencidas > 0 ? vencidas : proximas;
    hintEl.textContent = vencidas > 0
      ? `vencida${vencidas !== 1 ? 's' : ''} · ${proximas} próxima${proximas !== 1 ? 's' : ''}`
      : `próxima${proximas !== 1 ? 's' : ''}`;

    if (vencidas === 0) {
      card.classList.add('alertas-solo-proximas');
    } else {
      card.classList.remove('alertas-solo-proximas');
    }
    card.hidden = false;
  },

  // ==================== HELPERS ====================
  segundosPausados(servicioId) {
    return this.state.pausas
      .filter(p => p.servicio_orden_id === servicioId && p.hora_reanudacion !== null)
      .reduce((acc, p) => {
        const dur = (new Date(p.hora_reanudacion) - new Date(p.hora_pausa)) / 1000;
        return acc + Math.max(0, dur);
      }, 0);
  },

  pausaAbierta(servicioId) {
    return this.state.pausas
      .filter(p => p.servicio_orden_id === servicioId && p.hora_reanudacion === null)
      .sort((a, b) => new Date(b.hora_pausa) - new Date(a.hora_pausa))[0] || null;
  },

  enRango(fechaIso) {
    if (!fechaIso) return false;
    const f = new Date(fechaIso);
    return f >= new Date(this.state.fechaDesde) && f <= new Date(this.state.fechaHasta);
  },

  nombreUsuario(uid) {
    const u = this.state.usuarios.find(x => x.id === uid);
    return u ? u.nombre : '—';
  },

  nombreServicio(sid) {
    const s = this.state.serviciosCatalogo.find(x => x.id === sid);
    return s ? s.nombre : 'Servicio';
  },

  // ==================== 1. KPIs ====================
  renderKPIs() {
    // En taller AHORA = órdenes abierta + en_progreso (no completadas, no canceladas)
    const enTaller = this.state.ordenes.filter(
      o => o.estado === 'abierta' || o.estado === 'en_progreso'
    ).length;

    // En proceso (live): servicios en estado en_progreso
    const enProceso = this.state.servicios.filter(s => s.estado === 'en_progreso').length;

    // Pausados (live)
    const pausados = this.state.servicios.filter(s => s.estado === 'pausado').length;

    // Ingresos en el rango = órdenes creadas en el rango
    const ingresos = this.state.ordenes.filter(o => this.enRango(o.creada_en)).length;

    // Completados en el rango = órdenes completadas en el rango
    const completados = this.state.ordenes.filter(
      o => o.estado === 'completada' && this.enRango(o.cerrada_en)
    ).length;

    // Tiempo promedio servicio completado en el rango
    const serviciosCompletados = this.state.servicios.filter(
      s => s.estado === 'completado' && this.enRango(s.hora_fin) && s.tiempo_real_min
    );
    let tiempoProm = '—';
    if (serviciosCompletados.length > 0) {
      const sum = serviciosCompletados.reduce((acc, s) => acc + s.tiempo_real_min, 0);
      const avg = Math.round(sum / serviciosCompletados.length);
      tiempoProm = avg + ' min';
    }

    document.getElementById('kpi-en-taller').textContent = enTaller;
    document.getElementById('kpi-en-proceso').textContent = enProceso;
    document.getElementById('kpi-pausados').textContent = pausados;
    document.getElementById('kpi-ingresos').textContent = ingresos;
    document.getElementById('kpi-completados').textContent = completados;
    document.getElementById('kpi-tiempo-promedio').textContent = tiempoProm;
  },

  // ==================== KPI MODAL DETALLE ====================
  abrirKpiModal(tipo) {
    const titulos = {
      'en-taller': 'Vehículos en taller',
      'en-proceso': 'Servicios en proceso',
      'pausados': 'Servicios pausados',
      'ingresos': 'Órdenes ingresadas',
      'completados': 'Órdenes completadas',
      'alertas-mtto': 'Alertas de mantenimiento',
    };

    document.getElementById('kpi-modal-title').textContent = titulos[tipo] || 'Detalle';

    let html = '';

    if (tipo === 'alertas-mtto') {
      const alertas = (this.state.alertasMtto || []).slice().sort((a, b) => {
        if (a.estado !== b.estado) return a.estado === 'vencido' ? -1 : 1;
        return (b.pct_max || 0) - (a.pct_max || 0);
      });
      if (alertas.length === 0) {
        html = '<div class="empty-state"><p>Sin alertas activas.</p></div>';
      } else {
        html = alertas.map(a => {
          const cls = a.estado === 'vencido' ? 'vencido' : 'proximo';
          let detalle = '';
          if (a.km_recorridos != null && a.intervalo_km) {
            detalle = `${a.km_recorridos}/${a.intervalo_km} km`;
          } else if (a.dias_transcurridos != null && a.intervalo_dias) {
            detalle = `${a.dias_transcurridos}/${a.intervalo_dias} días`;
          }
          const gpsHint = a.km_gps_desactualizado ? ' ⏱' : '';
          const pct = a.pct_max != null ? Math.round(a.pct_max) + '%' : '—';
          return `
            <div class="kpi-modal-alerta-row">
              <span class="kpi-modal-alerta-dot ${cls}"></span>
              <div class="kpi-modal-alerta-info">
                <div class="kpi-modal-alerta-placa">${Utils.escapeHtml(a.placa)}${gpsHint} <small style="color:var(--text-muted); font-weight:400;">${Utils.escapeHtml((a.marca || '') + ' ' + (a.modelo || ''))}</small></div>
                <div class="kpi-modal-alerta-serv">${Utils.escapeHtml(a.servicio_nombre)} · ${Utils.escapeHtml(detalle)}</div>
              </div>
              <div class="kpi-modal-alerta-pct ${cls}">${pct}</div>
            </div>
          `;
        }).join('');
      }
      document.getElementById('kpi-modal-list').innerHTML = html;
      document.getElementById('kpi-modal').hidden = false;
      return;
    }

    if (tipo === 'en-taller') {
      const ordenes = this.state.ordenes.filter(o => o.estado === 'abierta' || o.estado === 'en_progreso');
      if (ordenes.length === 0) {
        html = '<div class="empty-state"><p>No hay vehículos en taller.</p></div>';
      } else {
        html = ordenes.map(o => {
          const serviciosOrden = this.state.servicios.filter(s => s.num_orden === o.num_orden);
          const total = serviciosOrden.length;
          const enProc = serviciosOrden.filter(s => s.estado === 'en_progreso').length;
          const pau = serviciosOrden.filter(s => s.estado === 'pausado').length;
          const pen = serviciosOrden.filter(s => s.estado === 'pendiente').length;
          const com = serviciosOrden.filter(s => s.estado === 'completado').length;
          const can = serviciosOrden.filter(s => s.estado === 'cancelado').length;

          const prio = o.prioridad === 'urgente'
            ? '<span class="kpi-badge kpi-badge-urgente">Urgente</span>' : '';

          // Fracción coloreada: completados / total (excluyendo cancelados)
          const totalActivos = total - can;
          const fraccionHtml = totalActivos > 0
            ? `<span class="progreso-fraccion">
                 <span class="prog-num prog-num-ok">${com}</span><span class="prog-sep">/</span><span class="prog-num prog-num-total">${totalActivos}</span>
                 <span class="prog-label">servicios</span>
               </span>`
            : '';

          return `
            <div class="kpi-item" data-orden="${o.num_orden}">
              <div class="kpi-item-info">
                <div class="kpi-item-titulo">
                  ${Utils.escapeHtml(o.placa)} · ${o.num_orden} ${prio}
                  ${fraccionHtml}
                </div>
                <div class="kpi-item-meta">${Utils.escapeHtml(o.motivo || 'Sin motivo')}</div>
                <div class="kpi-item-progress">
                  ${com > 0 ? `<span class="prog-tag prog-completado">✓ ${com} completado${com !== 1 ? 's' : ''}</span>` : ''}
                  ${enProc > 0 ? `<span class="prog-tag prog-en-progreso">▶ ${enProc} en curso</span>` : ''}
                  ${pau > 0 ? `<span class="prog-tag prog-pausado">‖ ${pau} pausado${pau !== 1 ? 's' : ''}</span>` : ''}
                  ${pen > 0 ? `<span class="prog-tag prog-pendiente">⏳ ${pen} pendiente${pen !== 1 ? 's' : ''}</span>` : ''}
                  ${can > 0 ? `<span class="prog-tag prog-cancelado">✗ ${can} cancelado${can !== 1 ? 's' : ''}</span>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    } else if (tipo === 'en-proceso') {
      const servs = this.state.servicios.filter(s => s.estado === 'en_progreso');
      if (servs.length === 0) {
        html = '<div class="empty-state"><p>No hay servicios en proceso.</p></div>';
      } else {
        html = servs.map(s => {
          const orden = this.state.ordenes.find(o => o.num_orden === s.num_orden);
          const placa = orden ? orden.placa : '—';
          const tecnico = this.nombreUsuario(s.tecnico_id);
          const inicio = s.hora_inicio ? this.formatearHora(s.hora_inicio) : '—';
          return `
            <div class="kpi-item" data-orden="${s.num_orden}">
              <div class="kpi-item-info">
                <div class="kpi-item-titulo">${Utils.escapeHtml(this.nombreServicio(s.servicio_id))}</div>
                <div class="kpi-item-meta">${Utils.escapeHtml(placa)} · ${s.num_orden} · ${Utils.escapeHtml(tecnico)} · desde ${inicio}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    } else if (tipo === 'pausados') {
      const servs = this.state.servicios.filter(s => s.estado === 'pausado');
      if (servs.length === 0) {
        html = '<div class="empty-state"><p>No hay servicios pausados.</p></div>';
      } else {
        const motivos = {
          repuesto: 'Esperando repuesto',
          cambio_unidad: 'Cambio de unidad',
          personal: 'Pausa personal',
          reasignacion_jefe: 'Reasignación'
        };
        html = servs.map(s => {
          const orden = this.state.ordenes.find(o => o.num_orden === s.num_orden);
          const placa = orden ? orden.placa : '—';
          const tecnico = this.nombreUsuario(s.tecnico_id);
          const pausa = this.pausaAbierta(s.id);
          const motivo = pausa ? (motivos[pausa.motivo] || pausa.motivo) : '—';
          const detalle = pausa?.detalle_repuesto ? ' — ' + pausa.detalle_repuesto : '';
          const desde = pausa ? this.formatearHora(pausa.hora_pausa) : '—';
          return `
            <div class="kpi-item" data-orden="${s.num_orden}">
              <div class="kpi-item-info">
                <div class="kpi-item-titulo">${Utils.escapeHtml(this.nombreServicio(s.servicio_id))}</div>
                <div class="kpi-item-meta">${Utils.escapeHtml(placa)} · ${s.num_orden} · ${Utils.escapeHtml(tecnico)}</div>
                <div class="kpi-item-meta motivo-text">${Utils.escapeHtml(motivo)}${Utils.escapeHtml(detalle)} · pausado desde ${desde}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    } else if (tipo === 'ingresos') {
      const ords = this.state.ordenes.filter(o => this.enRango(o.creada_en));
      if (ords.length === 0) {
        html = '<div class="empty-state"><p>Sin ingresos en este rango.</p></div>';
      } else {
        html = ords
          .sort((a, b) => new Date(b.creada_en) - new Date(a.creada_en))
          .map(o => {
            const fecha = this.formatearFecha(o.creada_en);
            const quien = this.nombreUsuario(o.creada_por);
            const estados = {
              abierta: 'Abierta', en_progreso: 'En proceso',
              completada: 'Completada', cancelada: 'Cancelada'
            };
            return `
              <div class="kpi-item" data-orden="${o.num_orden}">
                <div class="kpi-item-info">
                  <div class="kpi-item-titulo">${Utils.escapeHtml(o.placa)} · ${o.num_orden}</div>
                  <div class="kpi-item-meta">${fecha} · Por ${Utils.escapeHtml(quien)} · ${estados[o.estado] || o.estado}</div>
                </div>
              </div>
            `;
          }).join('');
      }
    } else if (tipo === 'completados') {
      const ords = this.state.ordenes.filter(o => o.estado === 'completada' && this.enRango(o.cerrada_en));
      if (ords.length === 0) {
        html = '<div class="empty-state"><p>Sin órdenes completadas en este rango.</p></div>';
      } else {
        html = ords
          .sort((a, b) => new Date(b.cerrada_en) - new Date(a.cerrada_en))
          .map(o => {
            const fecha = this.formatearFecha(o.cerrada_en);
            const serviciosOrden = this.state.servicios.filter(s => s.num_orden === o.num_orden);
            const tiempoTotal = serviciosOrden.reduce((acc, s) => acc + (s.tiempo_real_min || 0), 0);
            const completados = serviciosOrden.filter(s => s.estado === 'completado').length;
            const cancelados = serviciosOrden.filter(s => s.estado === 'cancelado').length;
            const totalActivos = serviciosOrden.length - cancelados;

            const fraccionHtml = totalActivos > 0
              ? `<span class="progreso-fraccion">
                   <span class="prog-num prog-num-ok">${completados}</span><span class="prog-sep">/</span><span class="prog-num prog-num-ok">${totalActivos}</span>
                   <span class="prog-label">servicios</span>
                 </span>`
              : '';

            return `
              <div class="kpi-item" data-orden="${o.num_orden}">
                <div class="kpi-item-info">
                  <div class="kpi-item-titulo">${Utils.escapeHtml(o.placa)} · ${o.num_orden} ${fraccionHtml}</div>
                  <div class="kpi-item-meta">Completada ${fecha} · ${tiempoTotal} min total${cancelados > 0 ? ` · ${cancelados} cancelado${cancelados !== 1 ? 's' : ''}` : ''}</div>
                </div>
              </div>
            `;
          }).join('');
      }
    }

    document.getElementById('kpi-modal-list').innerHTML = html;

    // Bindear clicks
    document.querySelectorAll('#kpi-modal-list .kpi-item').forEach(item => {
      item.addEventListener('click', () => {
        const num = item.dataset.orden;
        if (num) {
          window.location.href = `orden-detalle.html?orden=${encodeURIComponent(num)}`;
        }
      });
    });

    document.getElementById('kpi-modal').hidden = false;
  },

  cerrarKpiModal() {
    document.getElementById('kpi-modal').hidden = true;
  },

  // ==================== 2. ALERTAS ====================
  renderAlertas() {
    // Servicios completados en el rango con sospechoso=true
    const sospechosos = this.state.servicios.filter(
      s => s.estado === 'completado' && s.sospechoso === true && this.enRango(s.hora_fin)
    );

    const card = document.getElementById('alerta-card');
    if (sospechosos.length === 0) {
      card.hidden = true;
      return;
    }

    card.hidden = false;
    document.getElementById('alerta-count').textContent =
      `${sospechosos.length} servicio${sospechosos.length !== 1 ? 's' : ''} con tiempo fuera de rango`;

    const cont = document.getElementById('alerta-lista');
    cont.innerHTML = sospechosos.map(s => {
      const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
      const mediana = cat?.tiempo_promedio_min || 0;
      const ratio = mediana > 0 ? (s.tiempo_real_min / mediana).toFixed(1) : '?';
      const tipo = mediana > 0 && s.tiempo_real_min > mediana * 3
        ? `${ratio}× más lento`
        : mediana > 0 && s.tiempo_real_min < mediana * 0.1
          ? `${ratio}× sospechosamente rápido`
          : 'fuera de rango';
      const orden = this.state.ordenes.find(o => o.num_orden === s.num_orden);
      return `
        <div class="alerta-item" data-orden="${s.num_orden}">
          <div class="alerta-item-info">
            <div class="alerta-item-titulo">${Utils.escapeHtml(this.nombreServicio(s.servicio_id))}</div>
            <div class="alerta-item-meta">
              ${orden ? Utils.escapeHtml(orden.placa) : '—'} · ${s.num_orden} ·
              ${Utils.escapeHtml(this.nombreUsuario(s.tecnico_id))} ·
              ${s.tiempo_real_min} min (mediana ${mediana} min)
            </div>
          </div>
          <div class="alerta-item-tiempo">${tipo}</div>
        </div>
      `;
    }).join('');

    cont.querySelectorAll('.alerta-item').forEach(item => {
      item.addEventListener('click', () => {
        const num = item.dataset.orden;
        window.location.href = `orden-detalle.html?orden=${encodeURIComponent(num)}`;
      });
    });
  },

  // ==================== 3. TÉCNICOS EN VIVO ====================
  renderTecnicos() {
    // Detener cronómetros viejos (servicios en curso + pausas)
    Object.values(this.state.cronometros).forEach(i => clearInterval(i));
    Object.values(this.state.cronometrosPausa).forEach(i => clearInterval(i));
    this.state.cronometros = {};
    this.state.cronometrosPausa = {};

    const tecnicos = this.state.usuarios.filter(u => u.rol === 'tecnico');
    const cont = document.getElementById('tecnicos-list');

    if (tecnicos.length === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Sin técnicos activos.</p></div>';
      document.getElementById('tecnicos-stats').textContent = '0';
      return;
    }

    let trabajando = 0, pausado = 0, libre = 0;

    const html = tecnicos.map(t => {
      // TODOS sus servicios EN_PROGRESO (no solo el primero) — fix bug multi-actividad
      const serviciosActivos = this.state.servicios.filter(
        s => s.tecnico_id === t.id && s.estado === 'en_progreso'
      );
      const serviciosPausados = this.state.servicios.filter(
        s => s.tecnico_id === t.id && s.estado === 'pausado'
      );

      let estado, statusClass, cardClass, actividadHtml, tiempoHtml;

      if (serviciosActivos.length > 0) {
        trabajando++;
        estado = 'Trabajando';
        statusClass = 'status-trabajando';
        cardClass = 'tec-trabajando';

        // Mostrar TODOS los servicios activos con su cronómetro inline
        actividadHtml = serviciosActivos.map(sa => {
          const orden = this.state.ordenes.find(o => o.num_orden === sa.num_orden);
          const placa = orden ? orden.placa : '—';
          return `<div class="tecnico-actividad-linea">
                    <span class="placa-mini">${Utils.escapeHtml(placa)}</span>
                    <span class="actividad-nombre">${Utils.escapeHtml(this.nombreServicio(sa.servicio_id))}</span>
                    <span class="actividad-cronos" id="cron-${t.id}-${sa.id}">00:00:00</span>
                  </div>`;
        }).join('');

        // Si hay pausados también, agregarlos atenuados con cronómetro de pausa
        if (serviciosPausados.length > 0) {
          actividadHtml += serviciosPausados.map(sp => {
            const orden = this.state.ordenes.find(o => o.num_orden === sp.num_orden);
            const placa = orden ? orden.placa : '—';
            const pausa = this.pausaAbierta(sp.id);
            const motivos = {
              repuesto: 'repuesto', cambio_unidad: 'cambio unidad',
              personal: 'personal', reasignacion_jefe: 'reasignación'
            };
            const motivo = pausa ? (motivos[pausa.motivo] || pausa.motivo) : '';
            return `<div class="tecnico-actividad-linea atenuado">
                      <span class="placa-mini">${Utils.escapeHtml(placa)}</span>
                      <span class="actividad-nombre">${Utils.escapeHtml(this.nombreServicio(sp.servicio_id))}</span>
                      ${motivo ? `<span class="motivo-tag">${motivo}</span>` : ''}
                      <span class="actividad-cronos pausa-cronos-inline" id="pausa-cron-inline-${sp.id}" data-inicio="${pausa?.hora_pausa || ''}">--:--:--</span>
                    </div>`;
          }).join('');
        }

        // No mostrar tiempo total en columna derecha (cada servicio tiene el suyo)
        tiempoHtml = '';
      } else if (serviciosPausados.length > 0) {
        pausado++;
        estado = 'Pausado';
        statusClass = 'status-pausado';
        cardClass = 'tec-pausado';

        actividadHtml = serviciosPausados.map(sp => {
          const orden = this.state.ordenes.find(o => o.num_orden === sp.num_orden);
          const placa = orden ? orden.placa : '—';
          const pausa = this.pausaAbierta(sp.id);
          const motivos = {
            repuesto: 'repuesto', cambio_unidad: 'cambio unidad',
            personal: 'personal', reasignacion_jefe: 'reasignación'
          };
          const motivo = pausa ? (motivos[pausa.motivo] || pausa.motivo) : '';
          return `<div class="tecnico-actividad-linea">
                    <span class="placa-mini">${Utils.escapeHtml(placa)}</span>
                    <span class="actividad-nombre">${Utils.escapeHtml(this.nombreServicio(sp.servicio_id))}</span>
                    ${motivo ? `<span class="motivo-tag">${motivo}</span>` : ''}
                    <span class="actividad-cronos pausa-cronos-inline" id="pausa-cron-inline-${sp.id}" data-inicio="${pausa?.hora_pausa || ''}">--:--:--</span>
                  </div>`;
        }).join('');

        tiempoHtml = '';
      } else {
        libre++;
        estado = 'Libre';
        statusClass = 'status-libre';
        cardClass = 'tec-libre';
        actividadHtml = '<div class="tecnico-actividad-linea">Sin trabajo asignado</div>';
        tiempoHtml = '';
      }

      return `
        <div class="tecnico-card ${cardClass}">
          <div class="tecnico-status ${statusClass}"></div>
          <div class="tecnico-info">
            <div class="tecnico-nombre">${Utils.escapeHtml(t.nombre)}</div>
            <div class="tecnico-actividad">${actividadHtml}</div>
          </div>
          ${tiempoHtml}
        </div>
      `;
    }).join('');

    cont.innerHTML = html;

    document.getElementById('tecnicos-stats').textContent =
      `${trabajando} trabajando · ${pausado} pausados · ${libre} libres`;

    // Iniciar cronómetros para TODOS los servicios activos y pausados
    tecnicos.forEach(t => {
      // Servicios EN_PROGRESO: cronómetro de tiempo trabajado
      const serviciosActivos = this.state.servicios.filter(
        s => s.tecnico_id === t.id && s.estado === 'en_progreso'
      );
      serviciosActivos.forEach(sa => {
        if (sa.hora_inicio) {
          this.iniciarCronometroTecnico(t.id, sa);
        }
      });

      // Servicios PAUSADOS: cronómetro de tiempo pausado
      const serviciosPausados = this.state.servicios.filter(
        s => s.tecnico_id === t.id && s.estado === 'pausado'
      );
      serviciosPausados.forEach(sp => {
        const pausa = this.pausaAbierta(sp.id);
        if (pausa) {
          this.iniciarCronometroPausaInline(sp.id, pausa.hora_pausa);
        }
      });
    });
  },

  iniciarCronometroPausaInline(servicioId, horaPausaIso) {
    const elementId = 'pausa-cron-inline-' + servicioId;
    const inicioMs = new Date(horaPausaIso).getTime();
    const UMBRAL_ALERTA_MS = 2 * 60 * 60 * 1000;  // 2 horas

    const update = () => {
      const ahora = Date.now();
      const transcurridoMs = ahora - inicioMs;
      if (transcurridoMs < 0) {
        const el = document.getElementById(elementId);
        if (el) el.textContent = '--:--:--';
        return;
      }
      const totalSeg = Math.floor(transcurridoMs / 1000);
      const h = Math.floor(totalSeg / 3600);
      const m = Math.floor((totalSeg % 3600) / 60);
      const s = totalSeg % 60;
      const fmt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      const el = document.getElementById(elementId);
      if (el) {
        el.textContent = fmt;
        if (transcurridoMs > UMBRAL_ALERTA_MS) {
          el.classList.add('pausa-cronos-alerta');
        } else {
          el.classList.remove('pausa-cronos-alerta');
        }
      }
    };

    update();
    const key = 'pausa_inline_' + servicioId;
    this.state.cronometrosPausa[key] = setInterval(update, 1000);
  },

  iniciarCronometroTecnico(tecnicoId, servicio) {
    const elementId = 'cron-' + tecnicoId + '-' + servicio.id;
    const update = () => {
      const inicioMs = new Date(servicio.hora_inicio).getTime();
      const ahora = Date.now();
      const segPausados = this.segundosPausados(servicio.id);
      const transcurridoMs = ahora - inicioMs - (segPausados * 1000);
      const totalSeg = Math.max(0, Math.floor(transcurridoMs / 1000));
      const h = Math.floor(totalSeg / 3600);
      const m = Math.floor((totalSeg % 3600) / 60);
      const s = totalSeg % 60;
      const fmt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      const el = document.getElementById(elementId);
      if (el) el.textContent = fmt;
    };

    update();
    const key = tecnicoId + '_' + servicio.id;
    this.state.cronometros[key] = setInterval(update, 1000);
  },

  // ==================== 4. PRODUCTIVIDAD ====================
  renderProductividad() {
    const tecnicos = this.state.usuarios.filter(u => u.rol === 'tecnico');
    const cont = document.getElementById('productividad-list');

    // Servicios completados en el rango
    const completadosRango = this.state.servicios.filter(
      s => s.estado === 'completado' && this.enRango(s.hora_fin)
    );

    if (completadosRango.length === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Sin servicios completados en este rango.</p></div>';
      return;
    }

    // Agrupar por técnico
    const stats = {};
    tecnicos.forEach(t => {
      stats[t.id] = {
        id: t.id,
        nombre: t.nombre,
        codigo: t.codigo,
        servicios: 0,
        tiempoReal: 0,
        tiempoEsperado: 0,
        listaServicios: [],
      };
    });

    completadosRango.forEach(s => {
      if (!stats[s.tecnico_id]) return;
      stats[s.tecnico_id].servicios += 1;
      stats[s.tecnico_id].tiempoReal += s.tiempo_real_min || 0;

      const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
      const mediana = cat?.tiempo_promedio_min || 0;
      stats[s.tecnico_id].tiempoEsperado += mediana;
      stats[s.tecnico_id].listaServicios.push(s);
    });

    // Filtrar técnicos con al menos 1 servicio
    const filas = Object.values(stats)
      .filter(x => x.servicios > 0)
      .sort((a, b) => b.servicios - a.servicios);

    if (filas.length === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Sin servicios completados por técnicos en este rango.</p></div>';
      return;
    }

    let html = `
      <div class="prod-row prod-header">
        <div>Técnico</div>
        <div>Servicios</div>
        <div>Tiempo total</div>
        <div>Esperado</div>
        <div>Eficiencia</div>
      </div>
    `;

    html += filas.map(x => {
      let eficiencia = '—';
      let efClass = 'normal';
      if (x.tiempoEsperado > 0) {
        const ratio = x.tiempoReal / x.tiempoEsperado;
        const pct = Math.round(ratio * 100);

        if (ratio < 0.85) {
          efClass = 'eficiente';
          eficiencia = `${pct}% ⚡`;
        } else if (ratio <= 1.2) {
          efClass = 'normal';
          eficiencia = `${pct}%`;
        } else if (ratio <= 1.8) {
          efClass = 'lento';
          eficiencia = `${pct}%`;
        } else {
          efClass = 'muy-lento';
          eficiencia = `${pct}% ⚠️`;
        }
      }

      const tiempoTxt = x.tiempoReal >= 60
        ? `${Math.floor(x.tiempoReal / 60)}h ${x.tiempoReal % 60}m`
        : `${x.tiempoReal} min`;

      const espTxt = x.tiempoEsperado >= 60
        ? `${Math.floor(x.tiempoEsperado / 60)}h ${x.tiempoEsperado % 60}m`
        : `${x.tiempoEsperado} min`;

      // Detalle expandible
      const detalleServicios = x.listaServicios
        .sort((a, b) => new Date(b.hora_fin) - new Date(a.hora_fin))
        .map(s => {
          const cat = this.state.serviciosCatalogo.find(c => c.id === s.servicio_id);
          const orden = this.state.ordenes.find(o => o.num_orden === s.num_orden);
          const placa = orden?.placa || '—';
          const mediana = cat?.tiempo_promedio_min || 0;
          const tiempoReal = s.tiempo_real_min || 0;

          let detClass = 'detalle-normal';
          let detIcon = '';
          if (mediana > 0) {
            const ratio = tiempoReal / mediana;
            if (ratio < 0.85) { detClass = 'detalle-eficiente'; detIcon = '⚡'; }
            else if (ratio > 1.8) { detClass = 'detalle-lento'; detIcon = '⚠️'; }
            else if (ratio > 1.2) { detClass = 'detalle-medio'; }
          }

          const fechaFin = this.formatearHora(s.hora_fin);

          return `
            <div class="prod-detalle-item ${detClass}" data-orden="${s.num_orden}">
              <div class="prod-detalle-info">
                <div class="prod-detalle-titulo">${detIcon} ${Utils.escapeHtml(cat?.nombre || 'Servicio')}</div>
                <div class="prod-detalle-meta">${Utils.escapeHtml(placa)} · ${s.num_orden} · ${fechaFin}</div>
              </div>
              <div class="prod-detalle-tiempo">
                <div>${tiempoReal} min</div>
                ${mediana > 0 ? `<div class="prod-detalle-mediana">esperado: ${mediana} min</div>` : ''}
              </div>
            </div>
          `;
        }).join('');

      return `
        <div class="prod-row prod-row-clickable" data-tecnico="${x.id}">
          <div class="prod-tecnico">
            <span class="prod-toggle">▶</span>
            ${Utils.escapeHtml(x.nombre)}
          </div>
          <div class="prod-numero">${x.servicios}</div>
          <div class="prod-numero">${tiempoTxt}</div>
          <div class="prod-numero">${espTxt}</div>
          <div class="prod-eficiencia ${efClass}">${eficiencia}</div>
        </div>
        <div class="prod-detalle" id="prod-detalle-${x.id}" hidden>
          ${detalleServicios}
        </div>
      `;
    }).join('');

    cont.innerHTML = html;

    // Restaurar estado de expandidos (después de re-render por polling)
    this.state.tecnicosExpandidos.forEach(tid => {
      const detalle = document.getElementById('prod-detalle-' + tid);
      const row = cont.querySelector(`[data-tecnico="${tid}"]`);
      if (detalle && row) {
        detalle.hidden = false;
        const toggle = row.querySelector('.prod-toggle');
        if (toggle) toggle.textContent = '▼';
        row.classList.add('prod-row-expanded');
      }
    });

    // EVENT DELEGATION: un solo listener en el contenedor que sobrevive re-renders
    // Solo bindear si aún no se hizo (la primera vez)
    if (!cont.dataset.boundDelegate) {
      cont.dataset.boundDelegate = 'true';
      cont.addEventListener('click', (e) => {
        // Click en una fila clickeable
        const row = e.target.closest('.prod-row-clickable');
        if (row) {
          // Si el click vino de un detalle interior, manejarlo aparte
          const detalleItem = e.target.closest('.prod-detalle-item');
          if (detalleItem) {
            // Click en un servicio individual del detalle
            const num = detalleItem.dataset.orden;
            if (num) {
              window.location.href = `orden-detalle.html?orden=${encodeURIComponent(num)}`;
            }
            return;
          }

          // Click en el row de técnico → toggle del detalle
          const tid = row.dataset.tecnico;
          const detalle = document.getElementById('prod-detalle-' + tid);
          const toggle = row.querySelector('.prod-toggle');
          if (!detalle) return;

          const estaOculto = detalle.hidden;
          if (estaOculto) {
            detalle.hidden = false;
            if (toggle) toggle.textContent = '▼';
            row.classList.add('prod-row-expanded');
            this.state.tecnicosExpandidos.add(tid);
          } else {
            detalle.hidden = true;
            if (toggle) toggle.textContent = '▶';
            row.classList.remove('prod-row-expanded');
            this.state.tecnicosExpandidos.delete(tid);
          }
          return;
        }

        // Click directo en un servicio del detalle (cuando no se enmarcó en row)
        const detalleItem = e.target.closest('.prod-detalle-item');
        if (detalleItem) {
          const num = detalleItem.dataset.orden;
          if (num) {
            window.location.href = `orden-detalle.html?orden=${encodeURIComponent(num)}`;
          }
        }
      });
    }
  },

  // ==================== 5. CANCELACIONES ====================
  renderCancelaciones() {
    const cont = document.getElementById('cancelaciones-list');
    const lista = this.state.cancelaciones;

    document.getElementById('canc-count').textContent = lista.length;

    if (lista.length === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Sin cancelaciones en este rango.</p></div>';
      return;
    }

    cont.innerHTML = lista.map(c => {
      const orden = this.state.ordenes.find(o => o.num_orden === c.num_orden);
      const placa = orden?.placa || '—';
      const fecha = this.formatearFecha(c.cancelada_en);
      const quien = this.nombreUsuario(c.cancelada_por);

      return `
        <div class="canc-row" data-orden="${c.num_orden}">
          <div class="canc-icon">✗</div>
          <div class="canc-info">
            <div class="canc-titulo">${Utils.escapeHtml(placa)} · ${c.num_orden}</div>
            <div class="canc-motivo">"${Utils.escapeHtml(c.motivo)}"</div>
            <div class="canc-meta">${fecha} · Por ${Utils.escapeHtml(quien)}</div>
          </div>
        </div>
      `;
    }).join('');

    cont.querySelectorAll('.canc-row').forEach(row => {
      row.addEventListener('click', () => {
        const num = row.dataset.orden;
        window.location.href = `orden-detalle.html?orden=${encodeURIComponent(num)}`;
      });
    });
  },

  // ==================== UTILS ====================
  formatearFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },

  formatearHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },

  // ==================== REALTIME + POLLING ====================
  activarRealtime() {
    if (this.state.realtimeChannel) return;

    this.state.realtimeChannel = supabaseClient
      .channel('admin-tablero')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, () => this.cargarTodo())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios_orden' }, () => this.cargarTodo())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'historial_pausas' }, () => this.cargarTodo())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cancelaciones_orden' }, () => this.cargarTodo())
      .subscribe();

    Utils.log('Realtime admin activado');

    // Polling cada 15 segundos como fallback (solo cuando la pestaña está visible)
    this.iniciarPolling();
  },

  iniciarPolling() {
    if (this.state.pollingInterval) return;

    this.state.pollingInterval = setInterval(() => {
      // Solo refrescar si la pestaña está visible
      if (document.visibilityState === 'visible') {
        Utils.log('Polling: refrescando datos del tablero...');
        this.cargarTodo();
      }
    }, 15000);  // 15 segundos

    Utils.log('Polling iniciado (cada 15s)');
  },

  detenerPolling() {
    if (this.state.pollingInterval) {
      clearInterval(this.state.pollingInterval);
      this.state.pollingInterval = null;
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    console.error('Supabase no inicializado');
    return;
  }
  Admin.init();
});
