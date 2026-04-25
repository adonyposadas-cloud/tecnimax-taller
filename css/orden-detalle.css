/* =============================================================================
   TECNIMAX TALLER — Estilos del Detalle de Orden
   Pantalla compartida entre jefe y técnico (modo lectura por ahora)
   ============================================================================= */

.detalle-main {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 var(--sp-3);
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.btn-back {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.85rem;
  padding: 6px 12px;
  border-radius: var(--r-sm);
  cursor: pointer;
}

.btn-back:hover {
  color: var(--text);
  border-color: var(--text-muted);
}

.app-brand-mini {
  flex: 1;
  text-align: center;
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 500;
  color: var(--text);
  letter-spacing: 0.04em;
  margin: 0 var(--sp-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ============================================================================
   STATES
   ============================================================================ */
.loading-state,
.error-state {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: var(--sp-6);
  text-align: center;
  color: var(--text-muted);
}

.error-state button {
  margin-top: var(--sp-3);
}

/* ============================================================================
   TARJETAS
   ============================================================================ */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  overflow: hidden;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.card-soft {
  background: rgba(255,255,255,0.02);
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border-bottom: 1px solid var(--border);
}

.card-body {
  padding: var(--sp-4);
}

/* Vehículo */
.vehiculo-info { flex: 1; min-width: 0; }

.placa-grande {
  font-family: var(--font-mono);
  font-size: 1.4rem;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 0.04em;
}

.vehiculo-meta {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 3px;
}

.orden-meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
  align-items: flex-end;
}

.badge {
  font-size: 0.7rem;
  padding: 3px 10px;
  border-radius: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.badge.badge-urgente {
  background: rgba(220, 53, 69, 0.18);
  color: var(--rojo-urgente);
}

.badge.badge-normal {
  background: rgba(255,255,255,0.06);
  color: var(--text-muted);
}

.badge.badge-abierta {
  background: rgba(255, 193, 7, 0.16);
  color: var(--amarillo);
}

.badge.badge-en-progreso {
  background: rgba(46, 117, 182, 0.18);
  color: var(--azul-claro);
}

.badge.badge-completada {
  background: rgba(40, 167, 69, 0.18);
  color: var(--verde-ok);
}

/* Info grid */
.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
}

.info-item { min-width: 0; }

.info-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.info-value {
  font-size: 0.9rem;
  color: var(--text);
  word-wrap: break-word;
}

.info-block {
  margin-bottom: var(--sp-3);
}

.info-block:last-child { margin-bottom: 0; }

.info-text {
  font-size: 0.9rem;
  color: var(--text);
  line-height: 1.5;
}

/* ============================================================================
   SERVICIOS
   ============================================================================ */
.section-title-h2 {
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 500;
  margin: 0;
  letter-spacing: 0.02em;
}

.servicios-progress {
  background: rgba(255,255,255,0.08);
  color: var(--text);
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 0.78rem;
  font-weight: 600;
}

.servicios-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--border);
}

.servicio-row {
  background: var(--bg-card);
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.servicio-row:first-child { border-top: 1px solid var(--border); }

.servicio-icono {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  flex-shrink: 0;
}

.servicio-icono.estado-pendiente {
  background: rgba(255,255,255,0.06);
  color: var(--text-muted);
}

.servicio-icono.estado-en-progreso {
  background: rgba(46, 117, 182, 0.2);
  color: var(--azul-claro);
}

.servicio-icono.estado-pausado {
  background: rgba(255, 193, 7, 0.18);
  color: var(--amarillo);
}

.servicio-icono.estado-completado {
  background: rgba(40, 167, 69, 0.2);
  color: var(--verde-ok);
}

.servicio-detalle { flex: 1; min-width: 0; }

.servicio-nombre-d {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text);
}

.servicio-meta-d {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 2px;
}

.servicio-estado-text {
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.servicio-estado-text.txt-pendiente { color: var(--text-muted); }
.servicio-estado-text.txt-en-progreso { color: var(--azul-claro); }
.servicio-estado-text.txt-pausado { color: var(--amarillo); }
.servicio-estado-text.txt-completado { color: var(--verde-ok); }

/* ============================================================================
   RESPONSIVE
   ============================================================================ */
@media (max-width: 600px) {
  .info-grid {
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-2);
  }
  .placa-grande { font-size: 1.2rem; }
  .card-header { padding: var(--sp-3); flex-wrap: wrap; }
  .card-body { padding: var(--sp-3); }
  .servicio-row { padding: var(--sp-3); }
  .app-brand-mini { font-size: 0.85rem; }
}
