
import { defineComponent, h, ref, resolveComponent } from 'vue';
import { Context } from '@koishijs/client';
import './index.scss';
import './icons';

export default (ctx: Context) =>
{
  ctx.page({
    name: 'IIROSE',
    path: '/iirose',
    desc: "",
    authority: 4,
    icon: 'activity:iirose',
    component: defineComponent({
      setup()
      {
        const iframe = ref<HTMLIFrameElement>();
        return () => h(resolveComponent('k-layout'), {}, {
          default: () => h('iframe', { ref: iframe, src: "https://iirose.com", class: 'layout-iframe' }),
        });
      },
    }),
  });
};