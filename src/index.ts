import {
  Plugin,
  showMessage,
  Dialog,
  openTab,
  getFrontend,
} from "siyuan";

import "./index.scss";
import TaskList from "@/components/TaskList.svelte";
import { StoreManager } from "@/stores";
import { TaskStoreDB } from "@/stores/taskStoreDB";
import type { ViewType, PluginConfig } from "@/types";
import { DEFAULT_CONFIG } from "@/types";
import { SettingUtils } from "./libs/setting-utils";

const STORAGE_NAME = "things-config";
const TAB_TYPE = "things_tab";

export default class ThingsPlugin extends Plugin {
  private store: StoreManager;
  private settingUtils: SettingUtils;
  private dockElement: HTMLElement | null = null;
  private unsubTaskChange: (() => void) | null = null;
  private thingsApp: any = null; // 当前标签页的 Svelte 组件实例
  private thingsTab: any = null; // 当前标签页的 Tab 实例

  async onload() {
    console.log("[Things] Loading plugin...");

    this.store = new StoreManager(this);

    this.addIcons(`
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
      <symbol id="iconInbox" viewBox="0 0 1024 1024">
        <path d="M928 224V128h-32V96h-96v32h-32v9.28a224 224 0 0 0-179.2 22.72H544V96h-96v64h-64v192H192a96 96 0 0 0-96 96v384a96 96 0 0 0 96 96h640a96 96 0 0 0 96-96V448a96 96 0 0 0-7.68-37.76A225.6 225.6 0 0 0 928 352a224 224 0 0 0-32-115.2V224z" style="fill:#FFFFFF"/>
        <path d="M704 352m-192 0a192 192 0 1 0 384 0 192 192 0 1 0-384 0Z" style="fill:#E9EAEB"/>
        <path d="M832 384h-224v-64h-192v64H192a64 64 0 0 0-64 64v384a64 64 0 0 0 64 64h640a64 64 0 0 0 64-64V448a64 64 0 0 0-64-64z" style="fill:#FFFFFF"/>
        <path d="M704 640v128H320v-128H128v192a64 64 0 0 0 64 64h640a64 64 0 0 0 64-64v-192z" style="fill:#A3D4FF"/>
        <path d="M832 384h-160v32h160a32 32 0 0 1 32 32v192h-160v128H320v-128H160v-192a32 32 0 0 1 32-32h160v-32H192a64 64 0 0 0-64 64v384a64 64 0 0 0 64 64h640a64 64 0 0 0 64-64V448a64 64 0 0 0-64-64z m-96 480H192a32 32 0 0 1-32-32v-160h128v128h448v-128h128v160a32 32 0 0 1-32 32z" style="fill:#2A5082"/>
        <path d="M512 672l192-192H320l192 192z" style="fill:#A3D4FF"/>
        <path d="M608 288h-32V256h32zM512 672l192-192h-96v-160h-32v160h-128V256h-32v224h-96z m114.88-160L512 626.88 397.12 512zM448 224h-32V192h32zM512 160h-32V128h32zM608 224h-32V192h32z" style="fill:#2A5082"/>
        <path d="M512 384h-32V224h32z" style="fill:#2A5082"/>
        <path d="M800 160h96v32h-96z" style="fill:#BCC0C4"/>
        <path d="M864 128v96h-32V128zM832 288h-32V256h-32v32h-32v32h32v32h32v-32h32V288z" style="fill:#BCC0C4"/>
      </symbol>
      <symbol id="iconToday" viewBox="0 0 1024 1024">
        <path d="M512 85.9l138.4 280.5 309.6 45-224 218.4 52.9 308.3L512 792.5 235.1 938.1 288 629.8 64 411.4l309.6-45z" style="fill:#FFD400"/>
      </symbol>
      <symbol id="iconCalendar" viewBox="0 0 1024 1024">
        <path d="M912.256 279.808v466.304c0 105.728-85.632 191.488-191.488 191.488H254.464c-105.728 0-191.488-85.76-191.488-191.488V279.808C62.976 174.08 148.736 88.32 254.464 88.32h466.304c105.856 0 191.488 85.76 191.488 191.488z" style="fill:#FFFFFF"/>
        <path d="M912.384 279.808v25.6H63.104v-25.6C63.104 174.08 148.864 88.32 254.592 88.32h466.304c105.856 0 191.488 85.76 191.488 191.488z" style="fill:#FF4D3C"/>
        <path d="M388.736 431.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M487.68 431.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M586.624 431.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M685.696 431.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M784.64 431.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M190.72 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M289.792 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M388.736 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M487.68 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M586.624 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M685.696 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M784.64 543.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M190.72 655.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M289.792 655.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M388.736 655.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M487.68 655.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M586.624 655.616m-46.848 0a46.848 46.848 0 1 0 93.696 0 46.848 46.848 0 1 0-93.696 0Z" style="fill:#FF4D3C"/>
        <path d="M685.696 655.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M784.64 655.616m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M190.72 767.488m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M289.792 767.488m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M388.736 767.488m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M487.68 767.488m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
        <path d="M586.624 767.488m-21.504 0a21.504 21.504 0 1 0 43.008 0 21.504 21.504 0 1 0-43.008 0Z" style="fill:#100311"/>
      </symbol>
      <symbol id="iconAnytime" viewBox="0 0 1024 1024">
        <path d="M563.8144 559.872m-360.1408 0a360.1408 360.1408 0 1 0 720.2816 0 360.1408 360.1408 0 1 0-720.2816 0Z" style="fill:#9FA7FF"/>
        <path d="M600.0128 596.0704m-323.9936 0a323.9936 323.9936 0 1 0 647.9872 0 323.9936 323.9936 0 1 0-647.9872 0Z" style="fill:#8891FF"/>
        <path d="M637.0304 622.4896m-281.6512 0a281.6512 281.6512 0 1 0 563.3024 0 281.6512 281.6512 0 1 0-563.3024 0Z" style="fill:#6E75FF"/>
        <path d="M514.9696 928.4096a417.9456 417.9456 0 1 1 417.9456-417.9456 418.4064 418.4064 0 0 1-417.9456 417.9456z m0-774.4512a356.5056 356.5056 0 1 0 356.5056 356.5056 356.9152 356.9152 0 0 0-356.5056-356.5056z" style="fill:#2E3138"/>
        <path d="M676.096 594.3296H477.7984a50.7392 50.7392 0 0 1-50.6368-50.6368V378.1632a30.72 30.72 0 0 1 61.44 0v154.7264h187.4944a30.72 30.72 0 0 1 0 61.44z" style="fill:#2E3138"/>
      </symbol>
      <symbol id="iconSomeday" viewBox="0 0 1024 1024">
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
      <symbol id="iconLog" viewBox="0 0 1024 1024">
        <path d="M857.6 25.6a76.8 76.8 0 0 1 76.8 76.8v819.2a76.8 76.8 0 0 1-76.8 76.8H166.4a76.8 76.8 0 0 1-76.8-76.8V102.4a76.8 76.8 0 0 1 76.8-76.8h691.2zM716.8 704H307.2l-2.2528 0.064a38.4 38.4 0 0 0 0 76.672L307.2 780.8h409.6l2.2528-0.064a38.4 38.4 0 0 0 0-76.672L716.8 704z m0-460.8H307.2l-2.2528 0.064a38.4 38.4 0 0 0 0 76.672L307.2 320h409.6l2.2528-0.064a38.4 38.4 0 0 0 0-76.672L716.8 243.2z" style="fill:#6B57FE"/>
        <path d="M563.2 473.6a38.4 38.4 0 0 1 2.2528 76.736L563.2 550.4H307.2a38.4 38.4 0 0 1-2.2528-76.736L307.2 473.6h256z" style="fill:#FFBA00"/>
      </symbol>
      <symbol id="iconArea" viewBox="0 0 1024 1024">
        <path d="M0 0m128 0l768 0q128 0 128 128l0 768q0 128-128 128l-768 0q-128 0-128-128l0-768q0-128 128-128Z" style="fill:#EDF3FF"/>
        <path d="M517.28 483.68c14.08-5.6 35.104-4.704 46.944 1.92L864 654.592l-357.28 141.76c-14.08 5.6-35.104 4.704-46.944-1.92L160 625.408l357.28-141.76z" style="fill:#FFFFFF"/>
        <path d="M517.28 355.68c14.08-5.6 35.104-4.704 46.944 1.92L864 526.592l-357.28 141.76c-14.08 5.6-35.104 4.704-46.944-1.92L160 497.408l357.28-141.76z" style="fill:#B2CDFF"/>
        <path d="M517.28 227.68c14.08-5.6 35.104-4.704 46.944 1.92L864 398.592l-357.28 141.76c-14.08 5.6-35.104 4.704-46.944-1.92L160 369.408l357.28-141.76z" style="fill:#4A87FA"/>
      </symbol>
      <symbol id="iconProject" viewBox="0 0 1024 1024">
        <path d="M511.999693 0c282.76719 0 511.999693 229.232502 511.999693 511.999693s-229.232502 511.999693-511.999693 511.999693S0 794.766883 0 511.999693 229.232502 0 511.999693 0z" style="fill:#F95D81"/>
        <path d="M456.857326 916.37705c227.952503-37.990377 369.223458 0 369.223458 0A509.787854 509.787854 0 0 1 511.999693 1023.999386c-176.609174 0-332.328761-89.415626-424.365826-225.453945 0 0.39936 141.270955 155.821987 369.223459 117.831609z" style="fill:#FFFFFF" fill-opacity=".2" opacity=".6"/>
        <path d="M511.733453 854.773247c-288.706387-40.785896-342.169395 38.103017-342.169395 38.103017C260.239204 974.396855 380.200732 1023.999386 511.733453 1023.999386c176.609174 0 332.328761-89.415626 424.365825-225.453945 0 0.39936-135.659439 97.003462-424.365825 56.217566z" style="fill:#FFFFFF" fill-opacity=".16" opacity=".6"/>
        <path d="M501.001939 278.650713c4.874237-2.877438 12.718072-2.908158 17.65375 0l230.655861 136.109998c4.894717 2.867198 4.935677 7.516155 0 10.424314L518.655689 561.284783c-4.884477 2.887678-12.718072 2.918398-17.66399 0L270.335838 425.174785c-4.884477-2.867198-4.935677-7.516155 0-10.424314l230.655861-136.089518z m17.63327 47.267811c-4.863997-2.867198-12.799992-2.846718-17.61279 0l-150.589349 88.852427c-4.863997 2.867198-4.812797 7.557115 0 10.393594l150.589349 88.852427c4.863997 2.867198 12.799992 2.856958 17.61279 0l150.579109-88.852427c4.863997-2.867198 4.812797-7.546875 0-10.383354l-150.579109-88.872907v0.01024z m208.025475 178.278293a20.357108 20.357108 0 1 1 20.479988 35.194859L531.035841 665.169521c-11.202553 6.512636-26.869744 6.533116-38.113257 0L276.787034 539.391676a20.357108 20.357108 0 1 1 20.479988-35.194859l205.885316 119.807929c4.874237 2.836478 12.728312 2.856958 17.63327 0l205.885316-119.818169z m0 91.617226a20.357108 20.357108 0 1 1 20.479988 35.194858L531.035841 756.786746c-11.202553 6.512636-26.869744 6.533116-38.113257 0L276.787034 631.008901a20.357108 20.357108 0 1 1 20.479988-35.194858l205.885316 119.807928c4.874237 2.836478 12.728312 2.867198 17.63327 0l205.885316-119.807928z" style="fill:#FFFFFF"/>
      </symbol>
      <symbol id="iconAdd" viewBox="0 0 32 32">
        <path d="M16 4v12h12v4H16v12h-4V20H0v-4h12V4h4z"/>
      </symbol>
      <symbol id="iconSearch" viewBox="0 0 32 32">
        <path d="M22 20.59l4.59 4.59L24.59 27 20 22.41V22a10 10 0 110-20 10 10 0 110 20v.59zM14 22a8 8 0 100-16 8 8 0 000 16z"/>
      </symbol>
      <symbol id="iconCheck" viewBox="0 0 32 32">
        <path d="M13.667 21.333l-6.667-6.667 1.88-1.88 4.787 4.787 9.56-9.56 1.88 1.88-11.44 11.44z"/>
      </symbol>
      <symbol id="iconCircle" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2"/>
      </symbol>
    `);

    const pluginInstance = this;

    // 注册自定义标签页类型
    this.addTab({
      type: TAB_TYPE,
      init() {
        const view = this.data.view || "today";
        const viewId = this.data.viewId;
        console.log("[Things] Tab init:", view, viewId);

        const container = document.createElement("div");
        container.style.height = "100%";
        container.style.overflow = "hidden";
        this.element.appendChild(container);

        const app = new TaskList({
          target: container,
          props: {
            view: view,
            viewId: viewId,
            searchQuery: "",
            store: pluginInstance.store,
          },
        });

        (this.element as any).__thingsApp = app;
        pluginInstance.thingsApp = app;
        // this.parent 是实际的 Tab 实例（拥有 updateTitle, headElement 等方法）
        if ((this as any).parent) {
          pluginInstance.thingsTab = (this as any).parent;
          console.log("[Things] Tab captured via parent:", !!pluginInstance.thingsTab);
        }
      },
      destroy() {
        const app = (this.element as any).__thingsApp;
        if (app) {
          app.$destroy();
          (this.element as any).__thingsApp = null;
        }
        // 只有当前标签页被销毁时才清空引用
        const tab = (this as any).parent;
        if (pluginInstance.thingsTab === tab) {
          pluginInstance.thingsApp = null;
          pluginInstance.thingsTab = null;
        }
      },
    });

    // 注册左侧面板
    this.addDock({
      config: {
        position: "LeftTop",
        size: { width: 180, height: 0 },
        icon: "iconThings",
        title: "Things",
        hotkey: "⌥⌘T",
      },
      data: {},
      type: "things_nav",
      init: (dock) => {
        console.log("[Things] Dock init");
        this.dockElement = dock.element;
        this.renderDock(dock.element);
      },
      destroy() {
        this.dockElement = null;
      }
    });

    // 注册命令
    this.addCommand({
      langKey: "quickAddTask",
      hotkey: "⇧⌘N",
      callback: () => {
        this.quickAddTask();
      },
    });

    this.eventBus.on("click-blockicon", this.blockIconEvent.bind(this));

    this.settingUtils = new SettingUtils({
      plugin: this,
      name: STORAGE_NAME,
    });

    // 添加设置项
    this.settingUtils.addItem({
      key: "defaultView",
      value: "today",
      type: "select",
      title: "启动时默认显示",
      description: "每次打开思源时默认显示的视图",
      options: {
        inbox: "收件箱",
        today: "今天",
        upcoming: "计划",
        anytime: "随时",
        someday: "某天",
        log: "日志",
      },
    });

    // 监听任务变化，自动更新侧边栏计数
    this.unsubTaskChange = this.store.tasks.on(() => {
      if (this.dockElement) {
        this.updateCounts(this.dockElement);
      }
    });

    console.log("[Things] Plugin loaded");
  }

  async onLayoutReady() {
    await this.store.loadAll();
    await this.settingUtils.load();
    console.log("[Things] Data loaded, tasks:", this.store.tasks.count);

    if (this.dockElement) {
      this.updateCounts(this.dockElement);

      // 获取默认视图设置
      const defaultView = this.settingUtils.get("defaultView") || "today";

      // 应用默认视图的函数
      const applyDefaultView = () => {
        if (this.thingsApp && this.thingsTab) {
          this.thingsApp.$set({ view: defaultView, viewId: undefined, searchQuery: "" });
          this.updateTabTitle(this.getViewTitle(defaultView as ViewType));
          this.updateTabIcon(this.getViewIcon(defaultView as ViewType));
          this.setActive(this.dockElement!, defaultView as ViewType);
        }
      };

      // 等待思源完成标签页恢复
      setTimeout(() => {
        console.log("[Things] onLayoutReady: thingsApp=", !!this.thingsApp, "thingsTab=", !!this.thingsTab, "defaultView=", defaultView);
        if (this.thingsApp && this.thingsTab) {
          applyDefaultView();
        } else {
          this.openThingsTab(defaultView as ViewType);
          this.setActive(this.dockElement!, defaultView as ViewType);
        }
      }, 300);

      // 延迟二次更新，确保思源渲染完成后标题不被覆盖
      setTimeout(() => {
        applyDefaultView();
      }, 1500);
    }
  }

  async onunload() {
    console.log("[Things] Plugin unloaded");

    // 取消 store 监听
    if (this.unsubTaskChange) {
      this.unsubTaskChange();
      this.unsubTaskChange = null;
    }

    // 关闭所有 Things 相关的标签页
    const tabs = document.querySelectorAll(`[data-type="${TAB_TYPE}"]`);
    tabs.forEach(tab => {
      const closeBtn = tab.querySelector('.item__close');
      if (closeBtn) {
        (closeBtn as HTMLElement).click();
      }
    });
  }

  /**
   * 渲染停靠栏
   */
  private renderDock(element: HTMLElement) {
    const navItems = [
      { view: "inbox" as ViewType, icon: "iconInbox", label: "收件箱" },
      { view: "today" as ViewType, icon: "iconToday", label: "今天" },
      { view: "upcoming" as ViewType, icon: "iconCalendar", label: "计划" },
      { view: "anytime" as ViewType, icon: "iconAnytime", label: "随时" },
      { view: "someday" as ViewType, icon: "iconSomeday", label: "某天" },
      { view: "log" as ViewType, icon: "iconLog", label: "日志" },
    ];

    let html = `<div class="things-nav">`;

    // 搜索框
    html += `
      <div class="things-nav__search">
        <input type="text" class="things-nav__search-input" placeholder="快速查找" />
      </div>
    `;

    // 主要导航
    for (const item of navItems) {
      const iconHtml = `<svg class="things-nav__icon"><use xlink:href="#${item.icon}"></use></svg>`;
      html += `
        <div class="things-nav__item" data-view="${item.view}">
          ${iconHtml}
          <span class="things-nav__label">${item.label}</span>
          <span class="things-nav__count" data-count="${item.view}"></span>
        </div>
      `;
    }

    // 间隔线
    html += `<div class="things-nav__sep"></div>`;

    // 区域
    html += `
      <div class="things-nav__section">
        <div class="things-nav__header">
          <span>区域</span>
          <span class="things-nav__add" data-add="area">+</span>
        </div>
        <div id="things-areas"></div>
      </div>
    `;

    // 间隔线
    html += `<div class="things-nav__sep"></div>`;

    // 项目
    html += `
      <div class="things-nav__section">
        <div class="things-nav__header">
          <span>项目</span>
          <span class="things-nav__add" data-add="project">+</span>
        </div>
        <div id="things-projects"></div>
      </div>
    `;

    html += `</div>`;
    element.innerHTML = html;

    this.bindEvents(element);
    this.renderProjects(element);
    this.renderAreas(element);
    this.updateCounts(element);

    // 默认选中"今天"
    this.setActive(element, "today");
  }

  /**
   * 绑定事件
   */
  private bindEvents(element: HTMLElement) {
    // 主要导航点击
    element.querySelectorAll('.things-nav__item').forEach(el => {
      el.addEventListener('click', () => {
        const view = (el as HTMLElement).dataset.view as ViewType;
        console.log("[Things] Click:", view);
        this.openThingsTab(view);
        this.setActive(element, view);
      });
    });

    // 添加项目/区域
    element.querySelectorAll('.things-nav__add').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = (el as HTMLElement).dataset.add;
        if (type === 'project') {
          this.addProject(element);
        } else if (type === 'area') {
          this.addArea(element);
        }
      });
    });

    // 搜索框 - 点击后在编辑区域打开搜索
    const searchBox = element.querySelector('.things-nav__search') as HTMLElement;
    if (searchBox) {
      searchBox.addEventListener('click', () => {
        this.openSearchDialog();
      });
    }
  }

  /**
   * 渲染项目列表
   */
  private renderProjects(element: HTMLElement) {
    const container = element.querySelector('#things-projects');
    if (!container) return;

    const projects = this.store.projects.getActiveProjects();
    let html = '';

    for (const p of projects) {
      html += `
        <div class="things-nav__item things-nav__item--sub" data-view="project" data-id="${p.id}">
          <span class="things-nav__label">${p.name}</span>
        </div>
      `;
    }

    if (projects.length === 0) {
      html = '<div class="things-nav__empty">暂无</div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('.things-nav__item').forEach(el => {
      el.addEventListener('click', () => {
        const view = (el as HTMLElement).dataset.view as ViewType;
        const id = (el as HTMLElement).dataset.id;
        this.openThingsTab(view, id);
        this.setActive(element, view, id);
      });
    });
  }

  /**
   * 渲染区域列表
   */
  private renderAreas(element: HTMLElement) {
    const container = element.querySelector('#things-areas');
    if (!container) return;

    const areas = this.store.areas.getAll();
    let html = '';

    for (const a of areas) {
      html += `
        <div class="things-nav__item things-nav__item--sub" data-view="area" data-id="${a.id}">
          <span class="things-nav__label">${a.name}</span>
        </div>
      `;
    }

    if (areas.length === 0) {
      html = '<div class="things-nav__empty">暂无</div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('.things-nav__item').forEach(el => {
      el.addEventListener('click', () => {
        const view = (el as HTMLElement).dataset.view as ViewType;
        const id = (el as HTMLElement).dataset.id;
        this.openThingsTab(view, id);
        this.setActive(element, view, id);
      });
    });
  }

  /**
   * 设置选中状态
   */
  private setActive(element: HTMLElement, view: ViewType, id?: string) {
    element.querySelectorAll('.things-nav__item').forEach(el => {
      el.classList.remove('is-active');
      const elView = (el as HTMLElement).dataset.view;
      const elId = (el as HTMLElement).dataset.id;
      if (elView === view && (!id || elId === id)) {
        el.classList.add('is-active');
      }
    });
  }

  /**
   * 更新计数
   */
  private updateCounts(element: HTMLElement) {
    const counts: Record<string, number> = {
      inbox: this.store.tasks.getInboxTasks().length,
      today: this.store.tasks.getTodayTasks().length,
      upcoming: this.store.tasks.getUpcomingTasks().length,
      anytime: this.store.tasks.getAnytimeTasks().length,
      someday: this.store.tasks.getSomedayTasks().length,
    };

    element.querySelectorAll('[data-count]').forEach(el => {
      const view = (el as HTMLElement).dataset.count;
      const count = counts[view] || 0;
      el.textContent = count > 0 ? String(count) : '';
    });
  }

  /**
   * 打开标签页（复用已有标签，不重复创建）
   */
  private async openThingsTab(view: ViewType, viewId?: string, searchQuery?: string) {
    console.log("[Things] Opening tab:", view, viewId);

    const title = this.getViewTitle(view, viewId);

    // 如果已有标签页，直接更新内容
    if (this.thingsApp && this.thingsTab) {
      this.thingsApp.$set({
        view: view,
        viewId: viewId || undefined,
        searchQuery: searchQuery || "",
      });
      this.updateTabTitle(title);
      this.updateTabIcon(this.getViewIcon(view));
      return;
    }

    // 否则创建新标签页
    const tab = await openTab({
      app: this.app,
      custom: {
        icon: this.getViewIcon(view),
        title: title,
        data: {
          view: view,
          viewId: viewId || null,
          searchQuery: searchQuery || null,
        },
        id: this.name + TAB_TYPE,
      },
    });
    this.thingsTab = tab;
  }

  /**
   * 更新标签页标题（直接操作 DOM，确保对恢复的标签页也生效）
   */
  private updateTabTitle(title: string) {
    if (!this.thingsTab) return;
    // 设置内部属性
    this.thingsTab.title = title;
    if (typeof this.thingsTab.updateTitle === 'function') {
      this.thingsTab.updateTitle(title);
    }
    // 直接更新 headElement 中的标题文本
    const headEl = this.thingsTab.headElement;
    console.log("[Things] updateTabTitle:", title, "headEl:", !!headEl);
    if (headEl) {
      const textEl = headEl.querySelector('.item__text')
        || headEl.querySelector('[class*="text"]')
        || headEl.querySelector('span');
      if (textEl) {
        textEl.textContent = title;
      }
    }
  }

  /**
   * 更新标签页图标（直接操作 DOM）
   */
  private updateTabIcon(iconName: string) {
    if (!this.thingsTab) return;
    this.thingsTab.icon = iconName;
    if (typeof this.thingsTab.setDocIcon === 'function') {
      this.thingsTab.setDocIcon(iconName);
    }
    const headEl = this.thingsTab.headElement;
    if (headEl) {
      const useEl = headEl.querySelector('use');
      if (useEl) {
        useEl.setAttribute('xlink:href', `#${iconName}`);
      }
    }
  }

  /**
   * 获取视图对应的图标名
   */
  private getViewIcon(view: ViewType): string {
    const icons: Record<string, string> = {
      inbox: "iconInbox",
      today: "iconToday",
      upcoming: "iconCalendar",
      anytime: "iconAnytime",
      someday: "iconSomeday",
      log: "iconLog",
      project: "iconProject",
      area: "iconArea",
    };
    return icons[view] || "iconThings";
  }

  /**
   * 获取视图标题
   */
  private getViewTitle(view: ViewType, viewId?: string): string {
    const titles: Record<string, string> = {
      inbox: "收件箱",
      today: "今天",
      upcoming: "计划",
      anytime: "随时",
      someday: "某天",
      log: "日志",
      search: "搜索",
    };

    if (view === "project" && viewId) {
      const p = this.store.projects.get(viewId);
      return p?.name || "项目";
    }
    if (view === "area" && viewId) {
      const a = this.store.areas.get(viewId);
      return a?.name || "区域";
    }

    return titles[view] || "Things";
  }

  /**
   * 打开搜索对话框
   */
  private openSearchDialog() {
    // 检查是否已经打开
    const existingOverlay = document.querySelector('.things-search-overlay');
    if (existingOverlay) {
      (existingOverlay as HTMLElement).querySelector('input')?.focus();
      return;
    }

    // 获取编辑区域的位置
    const editorArea = document.querySelector('.layout__center') || document.body;
    const editorRect = editorArea.getBoundingClientRect();

    // 创建遮罩层，覆盖整个编辑区域
    const overlay = document.createElement('div');
    overlay.className = 'things-search-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: ${editorRect.top}px;
      left: ${editorRect.left}px;
      width: ${editorRect.width}px;
      height: ${editorRect.height}px;
      z-index: 300;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 60px;
      background: rgba(0, 0, 0, 0.3);
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      width: 500px;
      max-width: 80%;
      background: var(--b3-theme-surface);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      overflow: hidden;
    `;

    dialog.innerHTML = `
      <div style="padding: 16px;">
        <div style="display: flex; align-items: center; gap: 8px; background: var(--b3-theme-background); border: 1px solid var(--b3-border-color); border-radius: 8px; padding: 10px 14px;">
          <svg style="width: 18px; height: 18px; color: var(--b3-theme-on-surface-light); flex-shrink: 0;"><use xlink:href="#iconSearch"></use></svg>
          <input type="text" style="flex: 1; border: none; background: transparent; font-size: 15px; outline: none;" id="things-search-input" placeholder="搜索任务..." />
        </div>
        <div id="things-search-results" style="margin-top: 12px; max-height: 400px; overflow-y: auto;"></div>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const input = dialog.querySelector("#things-search-input") as HTMLInputElement;
    const results = dialog.querySelector("#things-search-results") as HTMLElement;

    setTimeout(() => input?.focus(), 100);

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    });

    // ESC 关闭
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.body.removeChild(overlay);
      }
    });

    let debounceTimer: any;
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const query = input.value.trim();
        if (query) {
          const tasks = this.store.tasks.search(query);
          this.renderSearchResults(results, tasks);
        } else {
          results.innerHTML = "";
        }
      }, 200);
    });
  }

  /**
   * 渲染搜索结果
   */
  private renderSearchResults(container: HTMLElement, tasks: any[]) {
    if (tasks.length === 0) {
      container.innerHTML = '<div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 20px;">未找到匹配任务</div>';
      return;
    }

    let html = '';
    for (const task of tasks) {
      const statusIcon = task.status === 'done' ? '✅' : '☐';
      html += `
        <div class="things-search-result" data-id="${task.id}" style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 4px;">
          <span>${statusIcon}</span>
          <span style="flex: 1;">${task.title}</span>
        </div>
      `;
    }
    container.innerHTML = html;

    // 绑定点击事件
    container.querySelectorAll('.things-search-result').forEach(el => {
      el.addEventListener('click', () => {
        const taskId = (el as HTMLElement).dataset.id;
        const task = this.store.tasks.get(taskId);
        if (task) {
          // 打开任务详情
          console.log("[Things] Open task:", task);
        }
      });
    });
  }

  /**
   * 添加项目
   */
  private async addProject(element: HTMLElement) {
    const name = prompt('输入项目名称:');
    if (name) {
      await this.store.projects.createProject({ name });
      this.renderProjects(element);
      showMessage(`项目已创建: ${name}`);
    }
  }

  /**
   * 添加区域
   */
  private async addArea(element: HTMLElement) {
    const name = prompt('输入区域名称:');
    if (name) {
      await this.store.areas.createArea({ name });
      this.renderAreas(element);
      showMessage(`区域已创建: ${name}`);
    }
  }

  /**
   * 快速添加任务
   */
  private quickAddTask() {
    const dialog = new Dialog({
      title: "快速添加任务",
      content: `
        <div style="padding: 16px;">
          <input type="text" class="b3-text-field fn__block" id="things-quick-title" placeholder="输入任务标题..." autofocus />
          <div style="margin-top: 12px; text-align: right;">
            <button class="b3-button b3-button--text" id="things-quick-cancel">取消</button>
            <button class="b3-button b3-button--text" id="things-quick-add">添加</button>
          </div>
        </div>
      `,
      width: "400px",
    });

    const input = dialog.element.querySelector("#things-quick-title") as HTMLInputElement;
    const addBtn = dialog.element.querySelector("#things-quick-add") as HTMLButtonElement;
    const cancelBtn = dialog.element.querySelector("#things-quick-cancel") as HTMLButtonElement;

    setTimeout(() => input?.focus(), 100);

    const handleAdd = async () => {
      const title = input.value.trim();
      if (title) {
        await this.store.tasks.createTask({ title });
        showMessage(`任务已添加: ${title}`);
        dialog.destroy();
        if (this.dockElement) {
          this.updateCounts(this.dockElement);
        }
      }
    };

    addBtn.addEventListener("click", handleAdd);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleAdd();
      if (e.key === "Escape") dialog.destroy();
    });
    cancelBtn.addEventListener("click", () => dialog.destroy());
  }

  /**
   * 块右键菜单
   */
  private blockIconEvent({ detail }: any) {
    detail.menu.addItem({
      id: "things_create_task",
      iconHTML: "",
      label: "创建任务",
      click: async () => {
        const blocks = detail.blockElements;
        if (blocks.length === 0) return;

        const firstBlock = blocks[0];
        const title = firstBlock.textContent?.trim() || "新任务";
        const blockId = firstBlock.dataset.nodeId;

        await this.store.tasks.createTask({
          title: title.substring(0, 100),
          blockId,
        });

        showMessage(`任务已创建`);
        if (this.dockElement) {
          this.updateCounts(this.dockElement);
        }
      },
    });
  }

  /**
   * 打开设置
   */
  openSetting(): void {
    const dialog = new Dialog({
      title: "Things 设置",
      content: '<div id="things-settings" style="padding: 16px;"></div>',
      width: "500px",
    });

    const settingsEl = dialog.element.querySelector("#things-settings");
    if (settingsEl) {
      // 添加设置项
      const key = "defaultView";
      const el = this.settingUtils.getElement(key);
      if (el) {
        // 更新元素值为当前设置值
        const item = this.settingUtils.settings.get(key);
        if (item && item.setEleVal) {
          item.setEleVal(el, item.value);
        }

        const wrapper = document.createElement("div");
        wrapper.style.marginBottom = "16px";

        // 添加标签
        const label = document.createElement("label");
        label.style.display = "block";
        label.style.marginBottom = "4px";
        label.style.fontWeight = "500";
        label.textContent = "启动时默认显示";
        wrapper.appendChild(label);

        // 添加描述
        const desc = document.createElement("div");
        desc.style.fontSize = "12px";
        desc.style.color = "#666";
        desc.style.marginBottom = "8px";
        desc.textContent = "每次打开思源时默认显示的视图";
        wrapper.appendChild(desc);

        // 添加变化事件监听
        el.addEventListener('change', async () => {
          const value = (el as HTMLSelectElement).value;
          await this.settingUtils.setAndSave(key, value);
          console.log(`[Things] Setting ${key} saved:`, value);
        });

        wrapper.appendChild(el);
        settingsEl.appendChild(wrapper);
      }
    }
  }
}
