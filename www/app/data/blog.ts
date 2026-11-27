import type { SiteLocale } from '../../site-config.ts';

export const blogPath = '/blog';
export const siteUpdate = {
  path: '/blog/a-clearer-open-element-site',
  published: '2026-11-27',
  en: {
    title: 'A clearer openElement site',
    summary:
      'The docs have a simpler structure, error codes can be looked up from a log, and the site makes language and appearance easier to control.',
    docsTitle: 'Find your way through the docs',
    docsCopy:
      'The manual is organized into Learn, Guides, Reference and Project. New readers can start with the quickstart, tutorial and core concepts. The same groups and destinations are available in English and Chinese, and the language switch takes you to the equivalent page.',
    docsLink: 'Browse the documentation',
    lookupTitle: 'Look up an export or a diagnostic',
    referenceCopy:
      'The API reference groups public exports by package. Filter by an export name, then use its detail and related documentation to decide whether it fits your code.',
    referenceLink: 'Browse the API reference',
    errorsCopy:
      'On the error codes page, paste a line or several lines of build output. If the log contains multiple recognized codes, you can choose which diagnostic to read.',
    errorsLink: 'Look up an error code',
    themeTitle: 'Choose how the site looks',
    themeCopy:
      'The light and dark controls save your choice between visits. Select the monitor icon labeled “Follow system” to match your device’s appearance.',
  },
  zh: {
    title: '更清晰的 openElement 网站',
    summary: '文档分区更清楚，可以直接粘贴日志查找错误码，网站的语言和外观也更容易调整。',
    docsTitle: '按分区浏览文档',
    docsCopy:
      '手册分为学习、指南、参考和项目四个部分。初次使用可以依次阅读快速开始、教程和核心概念。中英文文档采用相同的分区，切换语言时会打开同一页面的对应版本。',
    docsLink: '浏览文档',
    lookupTitle: '查找公开导出和诊断信息',
    referenceCopy:
      'API 参考按包整理公开导出。按导出名称筛选，打开详情或相关文档，即可判断它是否适合你的代码。',
    referenceLink: '浏览 API 参考',
    errorsCopy: '在错误码页面可以粘贴一行或多行构建日志。如果日志中含有多个可识别的错误码，可以选择要查看的诊断信息。',
    errorsLink: '查找错误码',
    themeTitle: '选择网站外观',
    themeCopy: '切换到亮色或暗色后，网站会记住你的选择。选择带有显示器图标的「跟随系统」，网站就会随设备的外观设置一起变化。',
  },
};

export const blogCopy = {
  en: {
    title: 'Blog',
    description: 'Dated notes on the openElement website and its documentation.',
    releaseNotes: 'Package release notes',
  },
  zh: {
    title: '博客',
    description: '记录 openElement 网站和文档的更新。',
    releaseNotes: '查看软件包发布说明',
  },
};

export function formatBlogDate(date: string, locale: SiteLocale): string {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(date));
}
