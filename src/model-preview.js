import * as THREE from 'three'
import { readPreference, savePreference } from './i18n.js'
let locale = readPreference('language', 'en') === 'zh' ? 'zh' : 'en'
function applyLanguage() {
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  document.querySelectorAll('[data-en]').forEach(el => { el.textContent = el.dataset[locale] })
  const button = document.querySelector('#language'); button.textContent = locale === 'en' ? '中文' : 'EN'; button.setAttribute('aria-label', locale === 'en' ? '切换到中文' : 'Switch to English')
}
document.querySelector('#language').addEventListener('click', () => { locale = locale === 'en' ? 'zh' : 'en'; savePreference('language', locale); applyLanguage() })
applyLanguage()
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
const manifest = await fetch('/models/characters.json').then(r => r.json())
const loader = new GLTFLoader(), views = [], clock = new THREE.Clock()
const colors = [0xebeee3, 0xe8eee4, 0xf1eade, 0xe8ebe4]
window.previewState = { loaded: 0, animation: 'idle', characters: [] }
for (const [i, info] of manifest.characters.entries()) {
  const article = document.createElement('article'); article.className = 'character'
  article.innerHTML = `<div class="view"><span class="status" data-en="Loading character…" data-zh="正在加载角色…">Loading character…</span></div><div class="label"><div><h2>${info.name}</h2><p data-en="32 animations · CC0" data-zh="32 组动画 · CC0">32 animations · CC0</p></div><small>0${i+1}</small></div>`
  document.querySelector('#gallery').append(article); applyLanguage()
  const element = article.querySelector('.view'), scene = new THREE.Scene()
  scene.background = new THREE.Color(colors[i]); article.style.background = `#${colors[i].toString(16)}`
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15
  element.append(renderer.domElement)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30); camera.position.set(1.5, 1.7, 5.8)
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, .8, 0); controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 2.2; controls.maxDistance = 8; controls.maxPolarAngle = Math.PI / 1.8; controls.update()
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc8b7d5, 2.4))
  const key = new THREE.DirectionalLight(0xfff3de, 3.3); key.position.set(-3, 5, 4); key.castShadow = true; key.shadow.mapSize.set(1024,1024); key.shadow.bias = -.0004; scene.add(key)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.72,.75,.09,64),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8})); base.position.y=-.045; base.receiveShadow=true; scene.add(base)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:.09}));ground.rotation.x=-Math.PI/2;ground.position.y=-.09;ground.receiveShadow=true;scene.add(ground)
  const view = { renderer, scene, camera, controls, mixer: null, actions: {}, action: null }; views.push(view)
  const resize = () => { const w=element.clientWidth,h=element.clientHeight; renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix() };new ResizeObserver(resize).observe(element);resize()
  loader.load(info.url, gltf => {
    const model=gltf.scene, box=new THREE.Box3().setFromObject(model), size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3())
    const scale=1.7/size.y; model.scale.setScalar(scale);model.position.set(-center.x*scale,-box.min.y*scale,-center.z*scale)
    model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});scene.add(model)
    view.mixer=new THREE.AnimationMixer(model);for(const clip of gltf.animations)view.actions[clip.name]=view.mixer.clipAction(clip)
    view.action=view.actions[window.previewState.animation]||view.actions.idle;view.action?.play()
    element.querySelector('.status').remove();window.previewState.loaded++;window.previewState.characters.push({id:info.id,animations:Object.keys(view.actions)})
  },undefined,error=>{element.querySelector('.status').textContent=locale === 'zh' ? '模型加载失败，请刷新重试' : 'Could not load. Please refresh.';console.error(error)})
}
for(const button of document.querySelectorAll('[data-animation]'))button.addEventListener('click',()=>{
  const name=button.dataset.animation;window.previewState.animation=name
  document.querySelectorAll('[data-animation]').forEach(b=>b.classList.toggle('active',b===button))
  for(const view of views){const action=view.actions[name];if(!action||action===view.action)continue;view.action?.fadeOut(.2);action.reset().fadeIn(.2).play();view.action=action}
})
function animate(){requestAnimationFrame(animate);const delta=Math.min(clock.getDelta(),.05);for(const v of views){v.controls.update();v.mixer?.update(delta);v.renderer.render(v.scene,v.camera)}}animate()
