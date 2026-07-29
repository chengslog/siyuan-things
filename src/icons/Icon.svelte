<script lang="ts">
  /**
   * 通用图标组件：按 symbol id 引用雪碧图（src/icons/sprite.ts）。
   * 单色图标颜色继承 CSS color（stroke:currentColor），也可用 color 显式指定。
   */
  export let name: string;                 // symbol id，如 "iconThingsStar"
  export let size: number | string = 16;   // 宽高（px）
  export let color: string = "";           // 显式颜色；空串 = 继承 currentColor
  export let klass: string = "";           // 附加 class
</script>

<svg
  class="things-icon {klass}"
  width={size}
  height={size}
  style={color ? `color: ${color};` : ""}
  aria-hidden="true"
>
  <use xlink:href={`#${name}`} />
</svg>

<style>
  .things-icon {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
  }
</style>
