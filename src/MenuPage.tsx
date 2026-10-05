import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Moon, Sun } from '@phosphor-icons/react';
import { useTheme } from './theme';
import { formatMenuPrice, menuCategories, menuDishes, menuPages, type MenuDish } from './menuContent';
import type { MenuBookHandle } from './MenuBook3D';
import './menu.css';

const MenuBook3D = lazy(() => import('./MenuBook3D'));
const mobileQuery = '(max-width: 767px)';
const subscribe = (notify: () => void) => {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const getMobile = () => window.matchMedia(mobileQuery).matches;
const reducedQuery = '(prefers-reduced-motion: reduce)';
const getReduced = () => window.matchMedia(reducedQuery).matches;
const subscribeReduced = (notify: () => void) => {
  const query = window.matchMedia(reducedQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

class BookBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function DishDialog({ dish, onClose }: { dish: MenuDish; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    const scrollY = window.scrollY;
    const bodyStyle = document.body.style;
    const saved = { position: bodyStyle.position, top: bodyStyle.top, width: bodyStyle.width, overflow: bodyStyle.overflow };
    element?.showModal();
    Object.assign(bodyStyle, { position: 'fixed', top: `-${scrollY}px`, width: '100%', overflow: 'hidden' });
    return () => {
      element?.close();
      Object.assign(bodyStyle, saved);
      window.scrollTo({ top: scrollY, behavior: 'instant' });
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="notebook-dialog" aria-labelledby="dish-dialog-title" aria-describedby="dish-dialog-description" onClose={event => { if (!event.currentTarget.open) onClose(); }} onCancel={event => { event.preventDefault(); onClose(); }}>
    <button type="button" className="notebook-dialog-close" autoFocus onClick={onClose}>Đóng <span aria-hidden="true">×</span></button>
    <img src={dish.image} alt={dish.name} width="900" height="700" />
    <div className="notebook-dialog-body">
      <span className="notebook-eyebrow">{dish.category}</span>
      <h2 id="dish-dialog-title">{dish.name}</h2>
      <p id="dish-dialog-description">{dish.description}</p>
      <strong className="notebook-price">{formatMenuPrice(dish.price)}</strong>
      <a className="notebook-order" href="tel:0933446996">Đặt món này <span aria-hidden="true">↗</span></a>
      <p className="notebook-phone-note">Gọi 0933 446 996 để đặt món qua điện thoại và xác nhận giá, tình trạng phục vụ. Không thanh toán trực tuyến.</p>
    </div>
  </dialog>;
}

export default function MenuPage() {
  const [theme, setTheme] = useTheme();
  const mobile = useSyncExternalStore(subscribe, getMobile, () => true);
  const [mobileBook, setMobileBook] = useState(false);
  const showBook = !mobile || mobileBook;
  const [previousShowBook, setPreviousShowBook] = useState(showBook);
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, () => true);
  const [selected, setSelected] = useState(0);
  const [target, setTarget] = useState(0);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [muted, setMuted] = useState(true);
  const [dish, setDish] = useState<MenuDish | null>(null);
  const book = useRef<MenuBookHandle>(null);
  const reader = useRef<HTMLElement>(null);
  const audio = useRef<AudioContext | null>(null);
  if (previousShowBook !== showBook) {
    setPreviousShowBook(showBook);
    setSelected(0);
    setTarget(0);
    setSceneBusy(false);
    setLoading(showBook && !failed);
  }
  const size = mobile ? 1 : 2;
  const first = Math.floor(selected / size) * size;
  const destination = Math.floor(target / size) * size;
  const last = Math.min(first + size, menuPages.length);
  const moving = first !== destination;
  const busy = loading || sceneBusy || moving;
  const next = first + Math.sign(destination - first) * size;

  useEffect(() => {
    if (!moving || !showBook) return;
    const timer = window.setTimeout(() => setSelected(next), reduced ? 0 : 720);
    return () => window.clearTimeout(timer);
  }, [moving, next, reduced, showBook]);

  useEffect(() => () => { void audio.current?.close(); }, []);

  const fail = useCallback(() => { setFailed(true); setSceneBusy(false); setLoading(false); }, []);
  const pageChanged = useCallback((page: number) => { setLoading(false); setSelected(page); setTarget(page); }, []);
  const selectDish = useCallback((id: string) => {
    const found = menuDishes.find(item => item.id === id);
    if (found) {
      if (!(document.activeElement instanceof HTMLElement) || document.activeElement === document.body) reader.current?.focus();
      setDish(found);
    }
  }, []);

  function paperSound() {
    if (muted) return;
    try {
      const context = audio.current ??= new AudioContext();
      void context.resume().catch(() => undefined);
      const buffer = context.createBuffer(1, context.sampleRate * .16, context.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < channel.length; index++) channel[index] = (Math.random() * 2 - 1) * .035 * (1 - index / channel.length);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => source.disconnect();
      source.start();
    } catch { return; }
  }

  function goTo(page: number) {
    if (loading) return;
    if (!Number.isInteger(page) || page < 0 || page >= menuPages.length) return;
    if (book.current && !failed) book.current.goTo(page);
    else {
      paperSound();
      setTarget(page);
    }
  }

  function turn(direction: number) {
    if (loading) return;
    if (book.current && !failed) book.current.turn(direction);
    else {
      paperSound();
      setTarget(value => Math.max(0, Math.min(Math.floor(value / size) * size + direction * size, Math.floor((menuPages.length - 1) / size) * size)));
    }
  }

  function renderPages(start: number, incoming = false) {
    return menuPages.slice(start, start + size).map((page, index) => <article className="notebook-page" key={page.id} aria-label={page.title}>
      <div className="notebook-running-head"><span>Ngọc Hiếu / {page.category ?? 'Mục lục'}</span><span>Thực đơn</span></div>
      {page.kind === 'contents' ? <div className="notebook-contents-page">
        <span className="notebook-eyebrow">Bít Tết Ngọc Hiếu</span><h2>Một món quen.<br />Một cuộc hẹn.</h2>
        <p>Chọn món, lật trang và cùng thưởng thức.</p>
        <nav aria-label="Mục lục trong sổ">{menuCategories.map(category => <button type="button" disabled={loading} key={category.name} aria-current={menuPages.slice(first, last).some(page => page.category === category.name) ? 'page' : undefined} onClick={() => goTo(category.page)}>{category.name}<span>{String(category.page + 1).padStart(2, '0')} ↗</span></button>)}</nav>
        <p className="notebook-editorial-note">Nhãn “Đề xuất” là gợi ý biên tập, không phải thống kê bán chạy.</p>
      </div> : page.dishes.map(item => <div className="notebook-dish-entry" key={item.id}>
        <button type="button" className="notebook-photo" onClick={() => selectDish(item.id)} aria-label={`Xem ảnh lớn và đặt món ${item.name}`} tabIndex={incoming ? -1 : undefined}>
          <img src={item.image} alt={item.name} width="700" height="800" decoding="async" />
          <span className="notebook-photo-hint">Xem món ↗</span>
        </button>
        <div className="notebook-dish">{item.badge && <span className="notebook-badge">{item.badge}</span>}<h2>{item.name}</h2><p>{item.description}</p><strong className="notebook-price">{formatMenuPrice(item.price)}</strong></div>
      </div>)}
      <div className="notebook-folio"><span>Bít Tết Ngọc Hiếu</span><span>{String(start + index + 1).padStart(2, '0')}</span></div>
    </article>);
  }

  const fallback = <div key={first} className={`notebook-cover is-open ${moving ? `is-turning ${destination > first ? 'turn-next' : 'turn-previous'}` : ''}`}>
    <div className="notebook-leaves"><div className="notebook-spread notebook-current">{renderPages(first)}</div>{moving && <div className="notebook-spread notebook-incoming" aria-hidden="true" inert>{renderPages(next, true)}</div>}</div>
  </div>;

  return <div className={`menu-notebook ${showBook ? 'has-book' : 'has-list'}`}>
    <title>Thực đơn | Bít Tết Ngọc Hiếu</title>
    <a className="notebook-skip" href="#notebook">Đến thực đơn</a>
    <header className="notebook-header">
      <a href="/" className="notebook-home"><span aria-hidden="true">←</span> Trang chủ</a><span className="notebook-brand">Ngọc Hiếu</span>
      <div className="notebook-actions"><button type="button" className="icon-button theme-toggle" aria-label={theme === 'light' ? 'Bật giao diện tối' : 'Bật giao diện sáng'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button><a href="/#dat-ban" className="notebook-booking">Đặt bàn <span aria-hidden="true">↗</span></a></div>
    </header>
    <main>
      <div className="notebook-heading"><h1>Thực đơn</h1><p>{showBook ? 'Lật từng trang. Chọn một món quen.' : 'Chọn món quen, gọi nhà hàng để đặt.'}</p></div>
      {mobile && <div className="notebook-view-switch"><button type="button" aria-pressed={mobileBook} aria-controls="notebook" onClick={() => setMobileBook(value => !value)}>{mobileBook ? 'Xem danh sách món' : 'Xem sách 3D'}</button><span>{mobileBook ? 'Có thể trở về danh sách bất cứ lúc nào.' : `${menuDishes.length} món · Không cần tải 3D`}</span></div>}
      {!showBook ? <section id="notebook" className="notebook-menu-list" aria-label="Danh sách thực đơn" tabIndex={-1}>
        <nav className="notebook-list-nav" aria-label="Danh mục món ăn">{menuCategories.map(category => <a key={category.name} href={`#menu-category-${category.page}`}>{category.name}</a>)}</nav>
        {menuCategories.map(category => <section className="notebook-list-category" key={category.name} aria-labelledby={`menu-category-${category.page}`}>
          <h2 id={`menu-category-${category.page}`} tabIndex={-1}>{category.name}</h2>
          {menuDishes.filter(item => item.category === category.name).map(item => <article className="notebook-list-dish" key={item.id} aria-labelledby={`menu-dish-${item.id}`}>
            <img src={item.image} alt={item.name} width="700" height="560" loading={item === menuDishes[0] ? 'eager' : 'lazy'} decoding="async" />
            <div className="notebook-list-copy">
              {item.badge && <span className="notebook-badge">{item.badge}</span>}
              <h3 id={`menu-dish-${item.id}`}>{item.name}</h3>
              <p>{item.description}</p>
              <div className="notebook-list-order"><strong className="notebook-price">{formatMenuPrice(item.price)}</strong><button type="button" className="notebook-order" aria-label={`Xem món ${item.name}`} onClick={() => selectDish(item.id)}>Xem món <span aria-hidden="true">↗</span></button></div>
            </div>
          </article>)}
        </section>)}
      </section> : <section ref={reader} id="notebook" className="notebook-reader" aria-label="Sổ thực đơn" aria-describedby="notebook-help" tabIndex={0} onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || dish) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); turn(event.key === 'ArrowLeft' ? -1 : 1); }
        if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); goTo(event.key === 'Home' ? 0 : menuPages.length - 1); }
      }}>
        <div className="notebook-toolbar"><nav className="notebook-category-nav" aria-label="Mục lục thực đơn"><button type="button" disabled={loading} onClick={() => goTo(0)} aria-current={first === 0 ? 'page' : undefined}>Mục lục</button>{menuCategories.map(category => <button type="button" disabled={loading} key={category.name} aria-current={menuPages.slice(first, last).some(page => page.category === category.name) ? 'page' : undefined} onClick={() => goTo(category.page)}>{category.name}</button>)}</nav><button type="button" className="notebook-sound" aria-pressed={!muted} onClick={() => setMuted(value => !value)}>Âm thanh: {muted ? 'Tắt' : 'Bật'}</button></div>
        <div id="notebook-pages" className={`notebook-stage${failed ? ' is-fallback' : ''}`} aria-busy={busy}>
          {loading && <div className="notebook-loading" role="status"><span className="notebook-eyebrow">Bít Tết Ngọc Hiếu</span><strong>Một món quen.<br />Một cuộc hẹn.</strong><span>Đang chuẩn bị sổ thực đơn…</span></div>}
          {failed ? fallback : <BookBoundary fallback={fallback} onError={fail}><Suspense fallback={null}><MenuBook3D ref={book} pages={menuPages} theme={theme} mobile={mobile} reduced={reduced} muted={muted} onPageChange={pageChanged} onBusyChange={setSceneBusy} onDishSelect={selectDish} onError={fail} /></Suspense></BookBoundary>}
        </div>
        <nav className="notebook-controls" aria-label="Lật trang thực đơn">
          <button type="button" disabled={loading || (!busy && first === 0)} aria-controls="notebook-pages" aria-disabled={loading || (!busy && first === 0)} onClick={() => turn(-1)}><span aria-hidden="true">←</span> Trang trước</button>
          <span className="notebook-indicator" role="status" aria-live="polite" aria-atomic="true">Trang {first + 1}{last > first + 1 ? `–${last}` : ''} / {menuPages.length}</span>
          <button type="button" disabled={loading || (!busy && last === menuPages.length)} aria-controls="notebook-pages" aria-disabled={loading || (!busy && last === menuPages.length)} onClick={() => turn(1)}>Trang sau <span aria-hidden="true">→</span></button>
        </nav>
        <p id="notebook-help" className="notebook-help">{failed ? 'Dùng nút lật trang hoặc phím ← / →.' : 'Kéo mép trang bằng chuột hoặc ngón tay; bấm mép trang hoặc dùng phím ← / →.'} Home: mục lục; End: trang cuối. Chọn ảnh để xem món.</p>
        {failed && <p className="notebook-help" role="status">Đang dùng sổ thực đơn nhẹ. Bạn vẫn có thể lật trang, xem món và gọi đặt món.</p>}
        <details className="notebook-accessible-menu"><summary>Danh sách món — đọc và chọn không cần 3D</summary><div>{menuDishes.map(item => <button type="button" key={item.id} onClick={() => selectDish(item.id)}><span><strong>{item.name}</strong><span>{item.description}</span></span><span>{formatMenuPrice(item.price)}</span></button>)}</div></details>
      </section>}
      <nav className="notebook-footer-actions" aria-label="Liên hệ nhà hàng"><a href="tel:0933446996">Gọi đặt món <span>0933 446 996</span></a><a href="/#dat-ban">Đặt bàn <span aria-hidden="true">↗</span></a></nav>
      <footer className="notebook-note"><p>Giá tham khảo từ website nhà hàng, đối chiếu ngày <time dateTime="2026-10-02">02/10/2026</time>. Vui lòng liên hệ để xác nhận giá và tình trạng phục vụ. “Đề xuất” là gợi ý biên tập.</p><a href="https://ngochieu.com.vn/" target="_blank" rel="noreferrer">Nguồn thực đơn <span aria-hidden="true">↗</span></a></footer>
    </main>
    {dish && <DishDialog dish={dish} onClose={() => setDish(null)} />}
  </div>;
}
