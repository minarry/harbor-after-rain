import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Adapt only browser entry points. OrbitControls' internal touch handoff already
// contains logical coordinates and must never pass through this mapping again.
export function createLandscapeOrbit(camera, canvas, viewport) {
  const orbit = new OrbitControls(camera);
  const host = viewport.window || canvas.ownerDocument.defaultView;
  let disposed = false;

  const mapEvent = event => {
    if (!viewport.rotated) return event;
    const point = viewport.clientToLocal(event.clientX, event.clientY);
    return new Proxy(event, {
      get(target, key) {
        // The page is fixed and cannot scroll in this fallback. Touch page
        // coordinates and mouse client coordinates share the logical viewport.
        if (key === 'clientX' || key === 'pageX') return point.x;
        if (key === 'clientY' || key === 'pageY') return point.y;
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };

  // Three r186 binds these before connect(). Keep the original event target and
  // native methods intact, including pointer capture and preventDefault().
  for (const name of ['_onPointerDown', '_onPointerMove', '_onPointerUp', '_onMouseWheel']) {
    const handler = orbit[name];
    orbit[name] = event => {
      if (disposed) return;
      // After resize, an old held finger may deliver events while a fresh
      // gesture is active. It no longer owns the camera and cannot end it.
      if ((name === '_onPointerMove' || name === '_onPointerUp') && !orbit._isTrackingPointer(event)) return;
      handler(mapEvent(event));
    };
  }
  orbit.connect(canvas);

  const releaseCaptures = pointers => {
    for (const id of pointers) {
      try { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); }
      catch { /* A cancelled browser contact may already be gone. */ }
    }
  };
  const cancelGesture = () => {
    if (disposed) return;
    const pointers = [...orbit._pointers], keyTarget = orbit._domElementKeyEvents;
    // disconnect clears pointer positions, action state and document handlers;
    // connect starts with no history from the previous coordinate system.
    orbit.disconnect();
    releaseCaptures(pointers);
    orbit.connect(canvas);
    if (keyTarget) orbit.listenToKeyEvents(keyTarget);
    if (pointers.length) orbit.dispatchEvent({ type: 'end' });
  };
  host?.addEventListener('gameviewportresize', cancelGesture);
  const dispose = orbit.dispose.bind(orbit);
  orbit.dispose = () => {
    if (disposed) return;
    disposed = true;
    host?.removeEventListener('gameviewportresize', cancelGesture);
    const pointers = [...orbit._pointers];
    dispose();
    releaseCaptures(pointers);
  };
  return orbit;
}
