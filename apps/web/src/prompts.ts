/**
 * Built-in style words for the prompt library. Our own wording; generic looks only — no studio,
 * artist or brand names. Click adds to the selected node's prompt; drag makes a text node.
 */
export interface StylePreset { label: string; text: string }
export const STYLE_GROUPS: { group: string; items: StylePreset[] }[] = [
  {
    group: '影像',
    items: [
      { label: '电影感', text: '电影感画面，浅景深，柔和逆光，细腻胶片颗粒，宽银幕构图' },
      { label: '纪实', text: '纪实摄影风格，自然光，真实质感，抓拍瞬间，略带颗粒' },
      { label: '胶片人像', text: '胶片人像，暖调肤色，柔焦背景，85mm 镜头，自然光' },
      { label: '清新日光', text: '清新明亮的日光，低饱和度，干净留白，空气感' },
      { label: '霓虹夜景', text: '霓虹灯夜景，湿润路面反光，青色与洋红对比，城市夜色' },
      { label: '黑白高反差', text: '黑白摄影，高反差，硬朗光影，深邃阴影' },
    ],
  },
  {
    group: '插画与动画',
    items: [
      { label: '手绘动画', text: '手绘动画风格，柔和水彩背景，干净线条，温暖色调' },
      { label: '赛璐璐', text: '赛璐璐动画风格，平涂上色，清晰描边，明快色彩' },
      { label: '扁平插画', text: '扁平插画，几何造型，有限配色，大面积色块' },
      { label: '水彩', text: '水彩画，晕染边缘，纸张纹理，通透色彩' },
      { label: '水墨', text: '中国水墨风，留白，墨色浓淡变化，写意笔触' },
      { label: '像素', text: '像素艺术，16 位游戏画面，清晰像素边缘，复古配色' },
    ],
  },
  {
    group: '3D 与产品',
    items: [
      { label: '3D 渲染', text: '3D 渲染，柔和棚拍光，干净背景，细节清晰，全局光照' },
      { label: '卡通 3D', text: '卡通 3D 风格，圆润造型，糖果色，柔和阴影' },
      { label: '产品棚拍', text: '产品棚拍，纯色背景，柔光箱布光，精致反光与细节' },
      { label: '微缩模型', text: '微缩模型效果，移轴摄影，浅景深，玩具般的质感' },
    ],
  },
  {
    group: '运镜（视频）',
    items: [
      { label: '缓慢推近', text: '镜头缓慢推近主体' },
      { label: '环绕', text: '镜头环绕主体平稳旋转' },
      { label: '手持跟拍', text: '手持跟拍，轻微晃动，临场感' },
      { label: '升降', text: '镜头从高处缓缓下降' },
      { label: '延时', text: '延时摄影，光影快速变化' },
    ],
  },
]
