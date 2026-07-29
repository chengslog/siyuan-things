/**
 * 图标雪碧图：全部 <symbol> 定义（唯一来源）。
 * 插件启动时通过 addIcons(ICON_SPRITE) 一次性挂载，
 * 全局以 <use xlink:href="#iconThingsXxx"> 引用（Icon.svelte 或裸 svg）。
 *
 * 约定：
 * 1. 多色视图图标（Things 品牌视觉，iconThings/Inbox/Today/...）：固定填充色。
 *    颜色必须写在各 path 的 inline style 里——思源主题 CSS 会覆盖 fill 属性，
 *    只有 inline style 能抗住（见 HANDOVER §4.5）。
 * 2. 单色动作图标（iconThingsStar/Moon/Flag/Tag/...，几何来自 Lucide，ISC 协议）：
 *    viewBox 24，inline style 写死 fill:none + stroke:currentColor，
 *    颜色由使用处的 CSS color / style 控制。
 * 3. symbol id 命名 iconThingsXxx，一经使用不可改名（恢复的标签页会缓存图标名）。
 */
export const ICON_SPRITE = `
      <symbol id="iconThings" viewBox="0 0 512 512">
        <defs>
          <linearGradient id="todoCheckGradient" x1="120" y1="120" x2="180" y2="380" gradientUnits="userSpaceOnUse">
            <stop stop-color="#5BEA72"/>
            <stop offset="1" stop-color="#19B957"/>
          </linearGradient>
          <linearGradient id="todoLineGradient" x1="250" y1="120" x2="400" y2="380" gradientUnits="userSpaceOnUse">
            <stop stop-color="#71849A"/>
            <stop offset="1" stop-color="#91A5B8"/>
          </linearGradient>
        </defs>
        <rect x="24" y="24" width="464" height="464" rx="96" style="fill:#F7FAFD"/>
        <path d="M92 157 L139 204 L214 124" style="stroke:url(#todoCheckGradient);fill:none" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="260" y="143" width="168" height="28" rx="14" style="fill:url(#todoLineGradient)"/>
        <path d="M92 269 L139 316 L214 236" style="stroke:url(#todoCheckGradient);fill:none" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="260" y="255" width="168" height="28" rx="14" style="fill:url(#todoLineGradient)"/>
        <circle cx="153" cy="390" r="34" style="stroke:#8FA3B7;fill:none" stroke-width="14"/>
        <rect x="260" y="376" width="168" height="28" rx="14" style="fill:#AFC0CF"/>
      </symbol>
      <symbol id="iconThingsInbox" viewBox="0 0 1024 1024">
        <path d="M928 224V128h-32V96h-96v32h-32v9.28a224 224 0 0 0-179.2 22.72H544V96h-96v64h-64v192H192a96 96 0 0 0-96 96v384a96 96 0 0 0 96 96h640a96 96 0 0 0 96-96V448a96 96 0 0 0-7.68-37.76A225.6 225.6 0 0 0 928 352a224 224 0 0 0-32-115.2V224z" style="fill:#CDE6FF"/>
        <path d="M704 352m-192 0a192 192 0 1 0 384 0 192 192 0 1 0-384 0Z" style="fill:#9FCDFF"/>
        <path d="M832 384h-224v-64h-192v64H192a64 64 0 0 0-64 64v384a64 64 0 0 0 64 64h640a64 64 0 0 0 64-64V448a64 64 0 0 0-64-64z" style="fill:#F2F9FF"/>
        <path d="M704 640v128H320v-128H128v192a64 64 0 0 0 64 64h640a64 64 0 0 0 64-64v-192z" style="fill:#5FB2FF"/>
        <path d="M832 384h-160v32h160a32 32 0 0 1 32 32v192h-160v128H320v-128H160v-192a32 32 0 0 1 32-32h160v-32H192a64 64 0 0 0-64 64v384a64 64 0 0 0 64 64h640a64 64 0 0 0 64-64V448a64 64 0 0 0-64-64z m-96 480H192a32 32 0 0 1-32-32v-160h128v128h448v-128h128v160a32 32 0 0 1-32 32z" style="fill:#2A5082"/>
        <path d="M512 672l192-192H320l192 192z" style="fill:#5FB2FF"/>
        <path d="M608 288h-32V256h32zM512 672l192-192h-96v-160h-32v160h-128V256h-32v224h-96z m114.88-160L512 626.88 397.12 512zM448 224h-32V192h32zM512 160h-32V128h32zM608 224h-32V192h32z" style="fill:#2A5082"/>
        <path d="M512 384h-32V224h32z" style="fill:#2A5082"/>
        <path d="M800 160h96v32h-96z" style="fill:#8FBCE8"/>
        <path d="M864 128v96h-32V128zM832 288h-32V256h-32v32h-32v32h32v32h32v-32h32V288z" style="fill:#8FBCE8"/>
      </symbol>
      <symbol id="iconThingsToday" viewBox="0 0 1024 1024">
        <path d="M512 85.9l138.4 280.5 309.6 45-224 218.4 52.9 308.3L512 792.5 235.1 938.1 288 629.8 64 411.4l309.6-45z" style="fill:#FFD400"/>
      </symbol>
      <symbol id="iconThingsCalendar" viewBox="0 0 1024 1024">
        <path d="M912.256 279.808v466.304c0 105.728-85.632 191.488-191.488 191.488H254.464c-105.728 0-191.488-85.76-191.488-191.488V279.808C62.976 174.08 148.736 88.32 254.464 88.32h466.304c105.856 0 191.488 85.76 191.488 191.488z" style="fill:#FFE9E6"/>
        <path d="M912.384 279.808v25.6H63.104v-25.6C63.104 174.08 148.864 88.32 254.592 88.32h466.304c105.856 0 191.488 85.76 191.488 191.488z" style="fill:#FF4D3C"/>
        <path d="M388.736 431.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M487.68 431.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M586.624 431.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M685.696 431.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M784.64 431.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M190.72 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M289.792 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M388.736 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M487.68 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M586.624 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M685.696 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M784.64 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M190.72 655.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M289.792 655.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M388.736 655.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M487.68 655.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M586.624 655.616m-46.848 0a46.848 46.848 0 1 0 93.696 0 46.848 46.848 0 1 0-93.696 0Z" style="fill:#FF4D3C"/>
        <path d="M685.696 655.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M784.64 655.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M190.72 767.488m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M289.792 767.488m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M388.736 767.488m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M487.68 767.488m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
        <path d="M586.624 767.488m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#5C6B84"/>
      </symbol>
      <symbol id="iconThingsAnytime" viewBox="0 0 1024 1024">
        <path d="M563.8144 559.872m-360.1408 0a360.1408 360.1408 0 1 0 720.2816 0 360.1408 360.1408 0 1 0-720.2816 0Z" style="fill:#9FA7FF"/>
        <path d="M600.0128 596.0704m-323.9936 0a323.9936 323.9936 0 1 0 647.9872 0 323.9936 323.9936 0 1 0-647.9872 0Z" style="fill:#8891FF"/>
        <path d="M637.0304 622.4896m-281.6512 0a281.6512 281.6512 0 1 0 563.3024 0 281.6512 281.6512 0 1 0-563.3024 0Z" style="fill:#6E75FF"/>
        <path d="M514.9696 928.4096a417.9456 417.9456 0 1 1 417.9456-417.9456 418.4064 418.4064 0 0 1-417.9456 417.9456z m0-774.4512a356.5056 356.5056 0 1 0 356.5056 356.5056 356.9152 356.9152 0 0 0-356.5056-356.5056z" style="fill:#2E3138"/>
        <path d="M676.096 594.3296H477.7984a50.7392 50.7392 0 0 1-50.6368-50.6368V378.1632a30.72 30.72 0 0 1 61.44 0v154.7264h187.4944a30.72 30.72 0 0 1 0 61.44z" style="fill:#2E3138"/>
      </symbol>
      <symbol id="iconThingsSomeday" viewBox="0 0 1024 1024">
        <path d="M133.0176 202.1888m147.0464 0l464.7424 0q147.0464 0 147.0464 147.0464l0 400.5888q0 147.0464-147.0464 147.0464l-464.7424 0q-147.0464 0-147.0464-147.0464l0-400.5888q0-147.0464 147.0464-147.0464Z" style="fill:#FF6464"/>
        <path d="M744.8064 202.1888h-91.8016a147.0464 147.0464 0 0 1 147.0464 147.0464v400.5888a147.0464 147.0464 0 0 1-147.0464 147.0464h91.8016a147.0464 147.0464 0 0 0 147.0976-147.0464V349.2352a147.0464 147.0464 0 0 0-147.0976-147.0464z" style="fill:#FF4436"/>
        <path d="M744.8064 912.2304H280.1152A162.6112 162.6112 0 0 1 117.76 749.824V349.2352a162.6112 162.6112 0 0 1 162.3552-162.4064h464.6912a162.6624 162.6624 0 0 1 162.4576 162.4064v400.5888a162.6624 162.6624 0 0 1-162.4576 162.4064zM280.1152 217.5488A131.84 131.84 0 0 0 148.48 349.2352v400.5888a131.84 131.84 0 0 0 131.7376 131.6864h464.6912a131.84 131.84 0 0 0 131.7376-131.6864V349.2352a131.84 131.84 0 0 0-131.7376-131.6864z" style="fill:#333333"/>
        <path d="M709.5296 412.9792H313.4464a15.36 15.36 0 0 1 0-30.72h396.0832a15.36 15.36 0 0 1 0 30.72z" style="fill:#333333"/>
        <path d="M323.8912 116.8896m52.2752 0l0.0512 0q52.2752 0 52.2752 52.2752l0 88.2688q0 52.2752-52.2752 52.2752l-0.0512 0q-52.2752 0-52.2752-52.2752l0-88.2688q0-52.2752 52.2752-52.2752Z" style="fill:#F1D000"/>
        <path d="M376.1664 116.8896a51.968 51.968 0 0 0-21.8624 5.12A52.224 52.224 0 0 1 384.6656 168.96v88.4736a52.224 52.224 0 0 1-30.3616 47.4112 52.1728 52.1728 0 0 0 74.1888-47.4112V168.96a52.3264 52.3264 0 0 0-52.3264-52.0704z" style="fill:#F2B200"/>
        <path d="M585.3184 116.8896m52.2752 0l0.0512 0q52.2752 0 52.2752 52.2752l0 88.2688q0 52.2752-52.2752 52.2752l-0.0512 0q-52.2752 0-52.2752-52.2752l0-88.2688q0-52.2752 52.2752-52.2752Z" style="fill:#F1D000"/>
        <path d="M637.7984 116.8896a52.224 52.224 0 0 0-21.9136 5.12 52.2752 52.2752 0 0 1 30.4128 46.9504v88.4736a52.2752 52.2752 0 0 1-30.4128 47.4112 52.1728 52.1728 0 0 0 74.1888-47.4112V168.96a52.2752 52.2752 0 0 0-52.2752-52.0704z" style="fill:#F2B200"/>
        <path d="M376.1664 325.0688a67.7376 67.7376 0 0 1-67.6352-67.6352V168.96a67.6352 67.6352 0 0 1 135.2704 0v88.4736a67.6864 67.6864 0 0 1-67.6352 67.6352z m0-192.8192A37.0176 37.0176 0 0 0 339.2512 168.96v88.4736a36.9152 36.9152 0 0 0 73.8304 0V168.96a36.9664 36.9664 0 0 0-36.9152-36.7104zM637.6448 325.0688a67.7376 67.7376 0 0 1-67.6864-67.6352V168.96a67.6864 67.6864 0 0 1 135.3216 0v88.4736a67.7376 67.7376 0 0 1-67.6352 67.6352z m0-192.8192a37.0176 37.0176 0 0 0-36.9664 36.7104v88.4736a36.9664 36.9664 0 0 0 73.8816 0V168.96a37.0176 37.0176 0 0 0-36.9152-36.7104z" style="fill:#333333"/>
        <path d="M420.608 725.4528a15.36 15.36 0 0 1-15.36-15.36V527.36l-49.9712 23.5008a15.36 15.36 0 1 1-13.056-27.8016l71.68-33.792a15.36 15.36 0 0 1 21.8624 13.9264v206.9504a15.36 15.36 0 0 1-15.1552 15.3088zM605.184 719.9232c-28.0576 0-63.7952-10.24-77.9776-58.4192l-0.3584-1.1264a15.36 15.36 0 0 1 29.3888-9.0624l0.4096 1.4848c4.6592 15.6672 14.6944 36.4032 48.5376 36.4032 24.7296-3.072 40.3968-14.0288 46.5408-32.6144 6.8096-20.48 0-45.3632-11.1616-55.552-30.4128-27.136-59.5456 0.768-62.7712 4.0448a15.36 15.36 0 0 1-11.008 4.7104h-20.9408a15.36 15.36 0 0 1-15.36-16.9472l9.7792-94.1568a15.36 15.36 0 0 1 15.36-13.7728H665.6a15.36 15.36 0 0 1 0 30.72h-95.8464l-6.4 61.44c21.0432-16.8448 60.4672-32.3072 98.2016 1.3312 21.2992 20.0192 29.5424 57.6512 19.5584 87.9104-5.7856 17.5104-22.9376 47.7696-72.9088 53.5552h-1.5872z" style="fill:#FFFFFF"/>
        <path d="M567.3472 820.0704H307.5584a15.36 15.36 0 1 1 0-30.72h259.7888a15.36 15.36 0 1 1 0 30.72zM714.4448 820.0704h-58.8288a15.36 15.36 0 0 1 0-30.72h58.8288a15.36 15.36 0 0 1 0 30.72z" style="fill:#333333"/>
      </symbol>
      <symbol id="iconThingsLog" viewBox="0 0 1024 1024">
        <path d="M857.6 25.6a76.8 76.8 0 0 1 76.8 76.8v819.2a76.8 76.8 0 0 1-76.8 76.8H166.4a76.8 76.8 0 0 1-76.8-76.8V102.4a76.8 76.8 0 0 1 76.8-76.8h691.2zM716.8 704H307.2l-2.2528 0.064a38.4 38.4 0 0 0 0 76.672L307.2 780.8h409.6l2.2528-0.064a38.4 38.4 0 0 0 0-76.672L716.8 704z m0-460.8H307.2l-2.2528 0.064a38.4 38.4 0 0 0 0 76.672L307.2 320h409.6l2.2528-0.064a38.4 38.4 0 0 0 0-76.672L716.8 243.2z" style="fill:#6B57FE"/>
        <path d="M563.2 473.6a38.4 38.4 0 0 1 2.2528 76.736L563.2 550.4H307.2a38.4 38.4 0 0 1-2.2528-76.736L307.2 473.6h256z" style="fill:#FFBA00"/>
      </symbol>
      <symbol id="iconThingsArea" viewBox="0 0 1024 1024">
        <path d="M0 0m128 0l768 0q128 0 128 128l0 768q0 128-128 128l-768 0q-128 0-128-128l0-768q0-128 128-128Z" style="fill:#EDF3FF"/>
        <path d="M517.28 483.68c14.08-5.6 35.104-4.704 46.944 1.92L864 654.592l-357.28 141.76c-14.08 5.6-35.104 4.704-46.944-1.92L160 625.408l357.28-141.76z" style="fill:#FFFFFF"/>
        <path d="M517.28 355.68c14.08-5.6 35.104-4.704 46.944 1.92L864 526.592l-357.28 141.76c-14.08 5.6-35.104 4.704-46.944-1.92L160 497.408l357.28-141.76z" style="fill:#B2CDFF"/>
        <path d="M517.28 227.68c14.08-5.6 35.104-4.704 46.944 1.92L864 398.592l-357.28 141.76c-14.08 5.6-35.104 4.704-46.944-1.92L160 369.408l357.28-141.76z" style="fill:#4A87FA"/>
      </symbol>
      <symbol id="iconThingsProject" viewBox="0 0 1024 1024">
        <path d="M511.999693 0c282.76719 0 511.999693 229.232502 511.999693 511.999693s-229.232502 511.999693-511.999693 511.999693S0 794.766883 0 511.999693 229.232502 0 511.999693 0z" style="fill:#F95D81"/>
        <path d="M456.857326 916.37705c227.952503-37.990377 369.223458 0 369.223458 0A509.787854 509.787854 0 0 1 511.999693 1023.999386c-176.609174 0-332.328761-89.415626-424.365826-225.453945 0 0.39936 141.270955 155.821987 369.223459 117.831609z" style="fill:#FFFFFF" fill-opacity=".2" opacity=".6"/>
        <path d="M511.733453 854.773247c-288.706387-40.785896-342.169395 38.103017-342.169395 38.103017C260.239204 974.396855 380.200732 1023.999386 511.733453 1023.999386c176.609174 0 332.328761-89.415626 424.365825-225.453945 0 0.39936-135.659439 97.003462-424.365825 56.217566z" style="fill:#FFFFFF" fill-opacity=".16" opacity=".6"/>
        <path d="M501.001939 278.650713c4.874237-2.877438 12.718072-2.908158 17.65375 0l230.655861 136.109998c4.894717 2.867198 4.935677 7.516155 0 10.424314L518.655689 561.284783c-4.884477 2.887678-12.718072 2.918398-17.66399 0L270.335838 425.174785c-4.884477-2.867198-4.935677-7.516155 0-10.424314l230.655861-136.089518z m17.63327 47.267811c-4.863997-2.867198-12.799992-2.846718-17.61279 0l-150.589349 88.852427c-4.863997 2.867198-4.812797 7.557115 0 10.393594l150.589349 88.852427c4.863997 2.867198 12.799992 2.856958 17.61279 0l150.579109-88.852427c4.863997-2.867198 4.812797-7.546875 0-10.383354l-150.579109-88.872907v0.01024z m208.025475 178.278293a20.357108 20.357108 0 1 1 20.479988 35.194859L531.035841 665.169521c-11.202553 6.512636-26.869744 6.533116-38.113257 0L276.787034 539.391676a20.357108 20.357108 0 1 1 20.479988-35.194859l205.885316 119.807929c4.874237 2.836478 12.728312 2.856958 17.63327 0l205.885316-119.818169z m0 91.617226a20.357108 20.357108 0 1 1 20.479988 35.194858L531.035841 756.786746c-11.202553 6.512636-26.869744 6.533116-38.113257 0L276.787034 631.008901a20.357108 20.357108 0 1 1 20.479988-35.194858l205.885316 119.807928c4.874237 2.836478 12.728312 2.867198 17.63327 0l205.885316-119.807928z" style="fill:#FFFFFF"/>
      </symbol>
      <symbol id="iconThingsAdd" viewBox="0 0 32 32">
        <path d="M16 4v12h12v4H16v12h-4V20H0v-4h12V4h4z"/>
      </symbol>
      <symbol id="iconThingsSearch" viewBox="0 0 32 32">
        <path d="M22 20.59l4.59 4.59L24.59 27 20 22.41V22a10 10 0 110-20 10 10 0 110 20v.59zM14 22a8 8 0 100-16 8 8 0 000 16z"/>
      </symbol>
      <symbol id="iconThingsCheck" viewBox="0 0 32 32">
        <path d="M13.667 21.333l-6.667-6.667 1.88-1.88 4.787 4.787 9.56-9.56 1.88 1.88-11.44 11.44z"/>
      </symbol>
      <symbol id="iconThingsCircle" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="12" style="fill:none;stroke:currentColor" stroke-width="2"/>
      </symbol>

      <!-- 单色动作图标（Lucide 几何，viewBox 24，stroke:currentColor，颜色随使用处 CSS color） -->
      <symbol id="iconThingsStar" viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
      </symbol>
      <symbol id="iconThingsStarFilled" viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" style="fill:currentColor;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
      </symbol>
      <symbol id="iconThingsMoon" viewBox="0 0 24 24">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
      </symbol>
      <symbol id="iconThingsMoonFilled" viewBox="0 0 24 24">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" style="fill:currentColor;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
      </symbol>
      <symbol id="iconThingsFlag" viewBox="0 0 24 24">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M4 22v-7" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
      </symbol>
      <symbol id="iconThingsTag" viewBox="0 0 24 24">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M7 7h.01" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
      </symbol>
      <symbol id="iconThingsBell" viewBox="0 0 24 24">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
      </symbol>
      <symbol id="iconThingsChecklist" viewBox="0 0 24 24">
        <path d="m3 17 2 2 4-4" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="m3 7 2 2 4-4" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M13 6h8" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M13 12h8" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M13 18h8" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
      </symbol>
      <symbol id="iconThingsNote" viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M14 2v6h6" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M16 13H8" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M16 17H8" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M10 9H8" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
      </symbol>
      <symbol id="iconThingsSubtask" viewBox="0 0 24 24">
        <path d="M11 12H3" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M16 6H3" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M16 18H3" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M18 9v6" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M21 12h-6" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
      </symbol>
      <symbol id="iconThingsCalendarLine" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M16 2v4" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M8 2v4" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="M3 10h18" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
      </symbol>
      <symbol id="iconThingsX" viewBox="0 0 24 24">
        <path d="M18 6 6 18" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
        <path d="m6 6 12 12" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
      </symbol>
    `;
