import { dishes } from './content';

export type MenuDish = {
  id: string;
  name: string;
  category: string;
  image: string;
  price: number | null;
  description: string;
  badge?: 'Đề xuất' | 'Bán chạy';
};

export type BookPage = {
  id: string;
  title: string;
  kind: 'contents' | 'dishes';
  category?: string;
  dishes: MenuDish[];
};

const additionalDishes = [
  { name: 'Bít tết truyền thống nhỏ (không xíu mại)', category: 'Bít tết', image: 'bit-tet-truyen-thong-khong-xiu-mai-sm.jpg', price: 115000, description: 'Phần bít tết truyền thống nhỏ, không xíu mại.' },
  { name: 'Bít tết sốt kem nấm', category: 'Bít tết', image: 'bit-tet-sot-kem-nam-nha-hang-bit-tet-ngoc-hieu-sm.jpg', price: 139000, description: 'Bít tết dùng cùng sốt kem nấm.' },
  { name: 'Bít tết đùi bò Mỹ áp chảo', category: 'Bít tết', image: 'BIT-TET-DUI-BO-MY-AP-CHAO-NHA-HANG-BIT-TET-NGOC-HIEU-sm.jpg', price: 139000, description: 'Đùi bò Mỹ chế biến áp chảo.' },
  { name: 'Bít tết Newyork áp chảo', category: 'Bít tết', image: 'bit-tet-new-york-nha-hang-bit-tet-ngoc-hieu-sm.jpg', price: 139000, description: 'Bít tết Newyork áp chảo cùng vị ngọt dịu của sốt BBQ.' },
  { name: 'Mỳ Ý chảo sốt ngao pesto', category: 'Mỳ Ý', image: 'my-y-sot-ngao-pesto-nha-hang-ngoc-hieu-sm.jpg', price: 129000, description: 'Mỳ Ý chảo với sốt ngao pesto.' },
  { name: 'Viên chiên 3 vị', category: 'Khai vị', image: 'vien-chien-ba-vi-ngoc-hieu-sm.jpg', price: 49000, description: 'Viên chiên ba vị, một lựa chọn để bắt đầu bữa ăn.' },
];

export const menuDishes: MenuDish[] = [...dishes.filter(dish => dish.category === 'Bít tết'), ...additionalDishes.filter(dish => dish.category === 'Bít tết'), ...dishes.filter(dish => dish.category === 'Mỳ Ý'), ...additionalDishes.filter(dish => dish.category !== 'Bít tết')].map((dish, index) => ({
  ...dish,
  id: dish.image.replace(/\.jpg$/, ''),
  image: `/images/${dish.image}`,
  ...(index === 0 ? { badge: 'Đề xuất' as const } : {}),
}));

export const menuPages: BookPage[] = [
  { id: 'contents', title: 'Mục lục', kind: 'contents', dishes: [] },
  ...menuDishes.map(dish => ({
    id: dish.id,
    title: dish.name,
    kind: 'dishes' as const,
    category: dish.category,
    dishes: [dish],
  })),
];

export const menuCategories = [...new Set(menuDishes.map(dish => dish.category))].map(name => ({
  name,
  page: menuPages.findIndex(page => page.category === name),
}));

const priceFormat = new Intl.NumberFormat('vi-VN');
export const formatMenuPrice = (price: number | null) => price === null ? 'Liên hệ nhà hàng' : `${priceFormat.format(price)} ₫`;
