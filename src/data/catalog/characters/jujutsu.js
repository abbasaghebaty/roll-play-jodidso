// Canonical Jujutsu character records. Keep stable ids/codes when display names change.
export const JUJUTSU_CHARACTERS = [
  {
    id: 'char_jjk_maki',
    code: 'MAKI',
    key: 'maki',
    name: { fa: 'ماکی زنین', en: 'Maki Zenin' },
    stats: { hp: 200, np: 0 },
    techniqueIds: ['tech_jjk_punch'],
    active: true,
  },
  {
    id: 'char_jjk_yuji',
    code: 'YUJI',
    key: 'yuji',
    name: { fa: 'یوجی ایتادوری', en: 'Yuji Itadori' },
    stats: { hp: 205, np: 210 },
    techniqueIds: ['tech_jjk_punch', 'tech_jjk_blackflash'],
    active: true,
  },
  {
    id: 'char_jjk_dummy',
    code: 'DUMMY',
    key: 'dummy',
    name: { fa: 'دامی', en: 'Dummy' },
    stats: { hp: 500, np: 500 },
    techniqueIds: [
      'tech_jjk_punch',
      'tech_jjk_blackflash',
      'tech_jjk_test_aoe',
      'tech_jjk_test_undef',
    ],
    active: false,
    hidden: true,
  },
];
