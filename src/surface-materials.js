// Shared by the playable map and material inspection scene.
import * as THREE from 'three';
export function createSurfaceMaterials(T) {
  const matDefs = {};
  const std = (p) => new THREE.MeshStandardMaterial(p);
  const surface = (s, properties = {}) => {
    const orm = s.ormMap || s.map?.userData?.weatherORM;
    return std({ map: s.map, normalMap: s.normalMap, ...properties,
      ...(orm ? { aoMap: orm, aoMapIntensity: .65, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1 } : {}) });
  };
  function defMat(key, mat, uv = 'unit', flags = {}) {
    mat.name=key;
    const source = mat.map?.userData?.pbrSource;
    if (source) {
      mat.userData.pbrSource = { ...source, normalRole: mat.normalMap?.userData?.pbrSource?.normalRole || 'macro+detail' };
      mat.userData.layerStats = { ...mat.map.userData.layerStats };
      mat.userData.weatherSurface = source.profile === 'wood-crate' ? 'wood' : 'metal';
    }
    if(key==='deck'||key==='paintY'||key==='paintW')mat.userData.weatherSurface='deck';
    else if(/^c\d/.test(key))mat.userData.weatherSurface='metal';
    matDefs[key] = { mat, uv, ...flags };
  }
  defMat('deck', surface(T.deck, { roughnessMap: T.deck.roughnessMap, roughness: .85, metalness: .12, normalScale: new THREE.Vector2(.8, .8), envMapIntensity: .6 }), 4, { shadow: false });
  T.containers.forEach((c, i) => {
    const side = (map, normalMap, ormMap) => surface({ map, normalMap, ormMap }, { roughness: .62, metalness: .3, normalScale: new THREE.Vector2(1.1, 1.1) });
    defMat(`c${i}s20`, side(c.side20, c.n20, c.orm20));
    defMat(`c${i}s40`, side(c.side40, c.n40, c.orm40));
    defMat(`c${i}s20Detail`, side(c.side20, c.detailN20 || c.n20, c.orm20));
    defMat(`c${i}s40Detail`, side(c.side40, c.detailN40 || c.n40, c.orm40));
    defMat(`c${i}door`, surface({ map: c.door, normalMap: c.doorN, ormMap: c.doorORM }, { roughness: .6, metalness: .3 }));
    defMat(`c${i}roof`, surface({ map: c.roof, normalMap: c.roofN, ormMap: c.roofORM }, { roughness: .75, metalness: .25 }));
  });
  T.crates.forEach((c, i) => defMat(`crate${i}`, surface(c, { roughness: c.kind === 'wood' ? .85 : .55, metalness: c.kind === 'wood' ? 0 : .4 })));
  defMat('bulkhead', surface(T.bulkhead, { roughness: .6, metalness: .25 }), 3);
  defMat('darkSteel', surface(T.darkSteel, { roughness: .55, metalness: .5 }), 3);
  defMat('interior', surface(T.darkSteel, { color: 0x8a8a84, roughness: .7, metalness: .3, envMapIntensity: .25 }), 2.4);
  defMat('yellow', surface(T.yellowSteel, { roughness: .5, metalness: .2 }), 3);
  defMat('red', surface(T.redSteel, { roughness: .5, metalness: .2 }), 3);
  defMat('green', surface(T.greenSteel, { roughness: .6, metalness: .25 }), 3);
  defMat('railYellow', std({ color: 0xd4a51c, roughness: 0.45, metalness: 0.25 }), 1);
  defMat('railWhite', std({ color: 0xe6e6e0, roughness: 0.5, metalness: 0.2 }), 1);
  defMat('black', std({ color: 0x1a1b1c, roughness: 0.8, metalness: 0.1 }), 1);
  defMat('steel', std({ color: 0x8a8f94, roughness: 0.35, metalness: 0.9 }), 1);
  defMat('orange', std({ color: 0xe0621a, roughness: 0.5, metalness: 0.1 }), 1);
  defMat('white', std({ color: 0xdedfda, roughness: 0.6, metalness: 0.1 }), 1);
  defMat('lamp', std({ color: 0xfff2d0, emissive: 0xffe2a8, emissiveIntensity: 3.5, roughness: 0.3 }), 1, { shadow: false });
  defMat('redLamp', std({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 4, roughness: 0.3 }), 1, { shadow: false });
  defMat('greenLamp', std({ color: 0x30ff60, emissive: 0x20ff50, emissiveIntensity: 4, roughness: 0.3 }), 1, { shadow: false });
  defMat('superWall', std({ map: T.superWall.map, emissiveMap: T.superWall.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.55, metalness: 0.15 }), [4, 3]);
  defMat('hull', surface(T.hull, { roughness: .6, metalness: .3 }), 'custom');
  const fenceMat = std({ map: T.fence, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.6 });
  defMat('fence', fenceMat, 1, { alpha: true });
  const gratMat = std({ map: T.grating, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.6 });
  defMat('grating', gratMat, 0.5, { alpha: true });
  defMat('signs', std({ map: T.signs, roughness: 0.6, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'custom', { shadow: false });
  defMat('paintY', std({ map: T.deck.map, color: 0xf0c030, roughness: 0.75, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 4, { shadow: false });
  defMat('paintW', std({ map: T.deck.map, color: 0xf4f4ee, roughness: 0.75, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 4, { shadow: false });
  defMat('wood', surface(T.crates[1], { roughness: .85 }), 1.2);

  return matDefs;
}
