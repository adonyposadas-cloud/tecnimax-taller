/**
 * router.js — Redirección por rol después del login
 */

const Router = {
  redirectByRole(profile) {
    if (!profile || !profile.rol) {
      window.location.href = './index.html';
      return;
    }

    switch (profile.rol) {
      case 'admin':
        window.location.href = './pages/admin.html';
        break;
      case 'jefe_pista':
        window.location.href = './pages/jefe.html';
        break;
      case 'tecnico':
        window.location.href = './pages/tecnico.html';
        break;
      default:
        Utils.log('Rol desconocido:', profile.rol);
        window.location.href = './index.html';
    }
  },
};
