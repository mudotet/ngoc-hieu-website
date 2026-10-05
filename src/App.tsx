import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, ForkKnife, List, MapPin, Moon, Phone, Sun, X } from '@phosphor-icons/react';
import { branches, dishes } from './content';
import { useTheme } from './theme';
import type { ThemeMode } from './theme';

const RestaurantScene = lazy(() => import('./RestaurantScene'));
const chapters = ['outside', 'doorway', 'signature', 'feedback', 'menu', 'booking', 'finale'];
const chapterLabels = ['Góc phố', 'Không gian', 'Món đặc trưng', 'Lời chia sẻ', 'Thực đơn', 'Đặt bàn', 'Hẹn gặp lại'];
const branchMaps = ['https://goo.gl/maps/Wo8xPmaaifnutBkJA', 'https://goo.gl/maps/rtJHYE34jsrTGkfg7', 'https://goo.gl/maps/mTBQCWR4mdbhk4mZ6', 'https://goo.gl/maps/E7kRqvAbDQ39DrxVA'];

function BookingForm() {
  const [request, setRequest] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const phone = event.currentTarget.elements.namedItem('phone') as HTMLInputElement;
    const digits = phone.value.replace(/\D/g, '');
    phone.setCustomValidity(digits.length >= 8 && digits.length <= 15 ? '' : 'Vui lòng nhập số điện thoại có 8-15 chữ số.');
    if (!event.currentTarget.reportValidity()) return;
    const data = new FormData(event.currentTarget);
    const body = `Xin chào Ngọc Hiếu,\nTôi muốn hỏi đặt bàn tại ${data.get('branch')}.\nHọ tên: ${data.get('name')}\nĐiện thoại: ${data.get('phone')}\nEmail: ${data.get('email') || 'Không cung cấp'}\nNgày giờ mong muốn: ${data.get('date')} ${data.get('time')}\nSố khách: ${data.get('guests')}\nVui lòng liên hệ xác nhận tình trạng bàn. Xin cảm ơn.`;
    const href = `mailto:bittetngochieu@gmail.com?subject=${encodeURIComponent('Yêu cầu đặt bàn Ngọc Hiếu')}&body=${encodeURIComponent(body)}`;
    setRequest(href);
  };
  return <form className="story-booking-form" onSubmit={submit} onChange={() => setRequest('')} aria-describedby="story-booking-note">
    <label htmlFor="story-booking-name">Tên của bạn<input id="story-booking-name" name="name" autoComplete="name" required maxLength={80} pattern=".*\S.*" /></label>
    <label htmlFor="story-booking-phone">Điện thoại<input id="story-booking-phone" name="phone" type="tel" autoComplete="tel" required onInput={event => event.currentTarget.setCustomValidity('')} pattern="(?=(?:\D*[0-9]){8,15}\D*$)\+?[0-9\s\(\).\-]{8,20}" title="Nhập 8-20 ký tự gồm số điện thoại, dấu + đầu số, khoảng trắng hoặc dấu ngoặc." /></label>
    <label className="form-wide" htmlFor="story-booking-email">Email <span>(không bắt buộc)</span><input id="story-booking-email" name="email" type="email" autoComplete="email" maxLength={120} /></label>
    <label htmlFor="story-booking-date">Ngày<input id="story-booking-date" name="date" type="date" required min={new Date().toLocaleDateString('en-CA')} /></label>
    <label htmlFor="story-booking-time">Giờ mong muốn<input id="story-booking-time" name="time" type="time" required /></label>
    <label htmlFor="story-booking-guests">Số khách<input id="story-booking-guests" name="guests" type="number" min="1" max="100" required defaultValue="2" /></label>
    <label htmlFor="story-booking-branch">Cơ sở<select id="story-booking-branch" name="branch" required>{branches.map(branch => <option key={branch.address}>{branch.address}</option>)}</select></label>
    <p className="form-wide" id="story-booking-note">Soạn yêu cầu, sau đó bấm mở ứng dụng email để kiểm tra và gửi. Bàn chỉ được xác nhận khi nhà hàng liên hệ lại.</p>
    <button className="button form-wide" type="submit">Soạn email đặt bàn <ArrowUpRight size={18} /></button>
    {request ? <p className="form-wide" role="status">Chưa gửi yêu cầu. <a href={request} target="_blank" rel="noopener noreferrer">Mở ứng dụng email để gửi</a> hoặc <a href="tel:0933446996">gọi 0933 446 996</a> nếu thiết bị chưa cài email.</p> : null}
  </form>;
}

const mobileScenes = [
  { chapter: 0, label: 'Góc phố', headline: 'Hẹn nhau ở Ngọc Hiếu.', image: 'official-hang-cot-reference.jpg', alt: 'Mặt tiền Ngọc Hiếu Hàng Cót, ảnh chính thức của nhà hàng', detail: 'Một góc phố Hà Nội, một cuộc hẹn bên chảo nóng. Ảnh từ website nhà hàng.' },
  { chapter: 2, label: 'Chảo nóng', headline: 'Chảo nóng. Vị thân quen.', image: dishes[0].image, alt: dishes[0].name, detail: 'Bít tết truyền thống, chảo gang hình bò và bánh mì nhà làm. Ảnh món ăn từ website nhà hàng.' },
  { chapter: 4, label: 'Thực đơn', headline: 'Chọn món cho bữa hẹn.', image: 'thuc-don-nhan-hang-bit-tet.jpg', alt: 'Thực đơn bít tết từ website chính thức Ngọc Hiếu', detail: 'Bít tết, mỳ Ý và những lựa chọn cho cả bàn. Mở quyển thực đơn để xem món và giá tham khảo.' },
];

function MobileJourney({ theme }: { theme: ThemeMode }) {
  const [stage, setStage] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const host = useRef<HTMLElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const scene = mobileScenes[stage];
  const requestedStage = useRef(0);
  const manualMode = useRef<boolean | null>(null);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const device = navigator as Navigator & { deviceMemory?: number; connection?: EventTarget & { saveData?: boolean } };
    const update = () => {
      const limited = motion.matches || Boolean(device.connection?.saveData);
      setRestricted(limited);
      if (limited) setReady(false);
      setEnabled(!limited && (manualMode.current ?? (device.hardwareConcurrency >= 4 && typeof device.deviceMemory === 'number' && device.deviceMemory >= 4)));
    };
    update();
    motion.addEventListener('change', update);
    device.connection?.addEventListener('change', update);
    return () => {
      motion.removeEventListener('change', update);
      device.connection?.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    const element = host.current;
    const loaded = () => { setReady(true); window.dispatchEvent(new Event('appready')); };
    element?.addEventListener('sceneready', loaded);
    return () => element?.removeEventListener('sceneready', loaded);
  }, []);

  const move = (index: number) => {
    const next = Math.max(0, Math.min(mobileScenes.length - 1, index));
    if (details.current) details.current.open = false;
    requestedStage.current = next;
    setStage(next);
    if (host.current) host.current.dataset.journey = chapters[mobileScenes[next].chapter];
    host.current?.dispatchEvent(new CustomEvent('storyseek', { detail: { index: mobileScenes[next].chapter } }));
  };
  const unavailable = () => { manualMode.current = false; setFailed(true); setEnabled(false); setReady(false); };


  return <section ref={host} id="home" className="hero mobile-cinema" data-journey={chapters[scene.chapter]} data-stage={stage} data-motion={restricted ? 'reduced' : 'full'} aria-label="Ba góc nhìn Ngọc Hiếu" aria-roledescription="bộ sưu tập"
    onTouchStart={event => {
      if (event.touches.length !== 1 || (event.target as HTMLElement).closest('a, button, details')) { touch.current = null; return; }
      touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }}
    onTouchMove={event => {
      if (touch.current && (event.touches.length !== 1 || Math.abs(event.touches[0].clientY - touch.current.y) > 28)) touch.current = null;
    }}
    onTouchCancel={() => { touch.current = null; }}
    onTouchEnd={event => {
      const start = touch.current;
      touch.current = null;
      if (!start || !event.changedTouches.length) return;
      const dx = event.changedTouches[0].clientX - start.x;
      const dy = event.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) move(requestedStage.current + (dx < 0 ? 1 : -1));
    }}>
    <figure className="mobile-cinema-photo" key={scene.image}><img src={`/images/${scene.image}`} alt={scene.alt} width="700" height="935" fetchPriority={stage === 0 ? 'high' : 'auto'} onLoad={() => window.dispatchEvent(new Event('appready'))} onError={() => window.dispatchEvent(new Event('appready'))} /></figure>
    {enabled && !failed ? <div className="hero-visual mobile-cinema-scene" data-ready={ready}><SceneBoundary onUnavailable={unavailable}><Suspense fallback={null}><RestaurantScene theme={theme} tourMode="steps" onUnavailable={unavailable} /></Suspense></SceneBoundary></div> : null}
    <div className="mobile-cinema-tools"><span>{enabled ? ready ? 'Không gian 3D minh họa' : 'Ảnh thật · Đang tải 3D' : 'Ảnh từ nhà hàng'}</span>{!restricted && !failed ? <button type="button" aria-pressed={enabled} onClick={() => { manualMode.current = !enabled; setReady(false); setEnabled(!enabled); }}>{enabled ? 'Dùng ảnh' : 'Bật 3D'}</button> : null}</div>
    <div className="mobile-cinema-content">
      <div className="mobile-cinema-heading" aria-live="polite" aria-atomic="true"><span className="mobile-cinema-count">0{stage + 1} / 03 · {scene.label}</span><h1>{scene.headline}</h1></div>
      {stage === 0 ? <button className="button" type="button" onClick={() => move(1)}>Khám phá chảo nóng <ArrowRight size={18} /></button> : stage === 1 ? <a className="button" href="#dat-ban">Hẹn một bữa ngon <ArrowUpRight size={18} /></a> : <a className="button story-menu-link" href="/thuc-don">Mở quyển thực đơn <ArrowUpRight size={18} /></a>}
      <details ref={details} className="mobile-cinema-details"><summary>Xem thêm <span className="sr-only">về {scene.label}</span></summary><p>{scene.detail}</p>{failed ? <p role="status">Thiết bị chưa hiển thị được 3D. Bạn đang xem ảnh thật của nhà hàng.</p> : null}</details>
      <nav className="mobile-cinema-nav" aria-label="Chọn cảnh"><button type="button" aria-label="Cảnh trước" disabled={stage === 0} onClick={() => move(requestedStage.current - 1)}><ArrowRight size={18} style={{ transform: 'rotate(180deg)' }} /></button><div>{mobileScenes.map((item, index) => <button key={item.chapter} type="button" aria-label={`Cảnh ${index + 1}: ${item.label}`} aria-current={stage === index ? 'step' : undefined} onClick={() => move(index)}><span aria-hidden="true" /></button>)}</div><button type="button" aria-label="Cảnh tiếp" disabled={stage === 2} onClick={() => move(requestedStage.current + 1)}><ArrowRight size={18} /></button></nav>
    </div>
  </section>;
}

class SceneBoundary extends Component<{ children: ReactNode; onUnavailable?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onUnavailable?.(); window.dispatchEvent(new Event('appready')); }
  render() { return this.state.failed ? <div className="scene-message">Không thể tải không gian 3D. Bạn vẫn có thể khám phá thực đơn bên dưới.</div> : this.props.children; }
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState('Tất cả');
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [chapter, setChapter] = useState(0);
  const chapterDetails = useRef<HTMLDetailsElement>(null);
  const requestedChapter = useRef(0);
  const sceneEnabled = !mobile;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const change = () => {
      setMobile(media.matches);
      setChapter(0); requestedChapter.current = 0;
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const hero = useRef<HTMLElement>(null);
  const [theme, setTheme] = useTheme();
  const root = useRef<HTMLDivElement>(null);
  const menuToggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = hero.current;
    const ready = () => window.dispatchEvent(new Event('appready'));
    element?.addEventListener('sceneready', ready);
    if (element?.dataset.sceneReady === 'true') ready();
    const image = !sceneEnabled ? element?.querySelector<HTMLImageElement>('.mobile-hero-photo img') : null;
    let active = true;
    const imageReady = () => {
      if (image?.decode) image.decode().catch(() => {}).then(() => { if (active) ready(); });
      else if (active) ready();
    };
    image?.addEventListener('load', imageReady, { once: true });
    image?.addEventListener('error', ready, { once: true });
    if (image?.complete) imageReady();
    return () => {
      active = false;
      element?.removeEventListener('sceneready', ready);
      image?.removeEventListener('load', imageReady);
      image?.removeEventListener('error', ready);
    };
  }, [sceneEnabled]);

  useEffect(() => {
    const nodes = root.current?.querySelectorAll('.reveal');
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.12 });
    nodes?.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    root.current?.querySelector<HTMLAnchorElement>('#navigation a')?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuToggle.current?.focus(); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);

  useEffect(() => {
    const element = hero.current;
    const change = (event: Event) => {
      const index: unknown = (event as CustomEvent<{ index?: unknown }>).detail?.index;
      if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < chapters.length) setChapter(index);
    };
    element?.addEventListener('storychapter', change);
    return () => element?.removeEventListener('storychapter', change);
  }, [mobile]);

  useEffect(() => {
    const overlay = hero.current?.querySelector<HTMLElement>('.story-overlay');
    if (overlay) overlay.scrollTop = 0;
    const details = chapterDetails.current;
    if (details) details.open = false;
    if (document.activeElement instanceof HTMLElement && details?.contains(document.activeElement)) {
      hero.current?.querySelector<HTMLElement>('.chapter-details summary')?.focus({ preventScroll: true });
    }
  }, [chapter]);

  const seek = (index: number) => {
    index = Math.max(0, Math.min(chapters.length - 1, index));
    requestedChapter.current = index;
    setChapter(index);
    if (hero.current) hero.current.dataset.journey = chapters[index];
    hero.current?.dispatchEvent(new CustomEvent('storyseek', { detail: { index } }));
  };

  const nav = [['Giới thiệu', '#cau-chuyen'], ['Thực đơn', '/thuc-don'], ['Hệ thống', '#he-thong'], ['Liên hệ', '#lien-he']];

  return <div ref={root} className="site" data-theme={theme}>
    <a className="skip-link" href="#main">Đến nội dung chính</a>
    <header className="header wrap">
      <a className="brand" href="#home" aria-label="Ngọc Hiếu, trang chủ"><img src="/images/ngoc-hieu-logo-white.jpg" alt="" width="48" height="48" /><span className="brand-wordmark">Ngọc Hiếu<small>Bít tết · Từ 1988</small></span></a>
      <nav className={menuOpen ? 'navigation open' : 'navigation'} aria-label="Điều hướng chính" id="navigation">
        {nav.map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
      </nav>
      <div className="header-actions">
        <button className="icon-button theme-toggle" aria-label={theme === 'light' ? 'Bật giao diện tối' : 'Bật giao diện sáng'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button>
        <a className="button small" href="#dat-ban">Đặt bàn <ArrowUpRight size={17} /></a>
        <button ref={menuToggle} className="icon-button mobile-toggle" aria-label={menuOpen ? 'Đóng menu' : 'Mở menu'} aria-controls="navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={24} /> : <List size={24} />}</button>
      </div>
    </header>

    <main id="main">
      {mobile ? <MobileJourney theme={theme} /> : <section ref={hero} id="home" data-journey={chapters[chapter]} className="hero cinematic-story" aria-label={sceneEnabled ? 'Hành trình bảy chương tại Ngọc Hiếu' : 'Nhà hàng Ngọc Hiếu'}>
        {sceneEnabled ? <>
          <div className="hero-visual"><SceneBoundary><Suspense fallback={<div className="scene-loading" role="status"><span>Đang mở cửa nhà hàng...</span></div>}><RestaurantScene theme={theme} tourMode={mobile ? 'steps' : 'scroll'} /></Suspense></SceneBoundary></div>
          <a className="story-skip" href="#cau-chuyen">Bỏ qua hành trình <ArrowDownRight size={18} /></a>
          <div className="story-overlay" onWheel={event => event.stopPropagation()} onTouchMove={event => event.stopPropagation()}>
            <article className="chapter-panel" data-chapter={chapter} aria-labelledby={`chapter-title-${chapter}`}>
              <span className="eyebrow">0{chapter + 1} / 07 · {chapterLabels[chapter]}</span>
              <h1 id={`chapter-title-${chapter}`}>{['Mời bạn ghé Ngọc Hiếu.', 'Một góc quen. Một cuộc hẹn.', 'Chảo nóng. Vị thân quen.', 'Sau bữa ăn, là lời chia sẻ.', 'Chọn món bạn thích.', 'Giữ một lời hẹn.', 'Phố vẫn đi. Mình ngồi lại.'][chapter]}</h1>
              {chapter === 0 ? <button className="button" onClick={() => seek(1)}>Bước vào câu chuyện <ArrowRight size={18} /></button> : null}
              {chapter === 1 ? <a className="button" href="#he-thong">Tìm cơ sở <MapPin size={18} /></a> : null}
              {chapter === 2 ? <a className="button" href="tel:0933446996">Gọi đặt món <Phone size={18} /></a> : null}
              {chapter === 3 ? <a className="button" href="https://www.facebook.com/bittetngochieu" target="_blank" rel="noreferrer">Xem trên Facebook <ArrowUpRight size={18} /></a> : null}
              {chapter === 4 ? <a className="button story-menu-link" href="/thuc-don">Mở quyển thực đơn <ArrowUpRight size={18} /></a> : null}
              {chapter >= 5 ? <a className="button" href="#dat-ban">Đặt bàn tại Ngọc Hiếu <ArrowUpRight size={18} /></a> : null}
              <details ref={chapterDetails} className="chapter-details"><summary>Xem thêm<span className="sr-only"> về {chapterLabels[chapter]}</span></summary>
                {chapter === 0 ? <p>Giữa nhịp phố Hà Nội, có một chiếc chảo nóng đang chờ. {mobile ? 'Chọn chương trước hoặc tiếp theo để khám phá.' : 'Cuộn để khám phá hoặc chọn chương để đi thẳng.'}</p> : null}
                {chapter === 1 ? <><figure className="chapter-photo"><img src="/images/official-hang-cot-reference.jpg" alt="Mặt tiền nhà hàng Ngọc Hiếu Hàng Cót, ảnh chính thức" width="700" height="935" loading="lazy" /><figcaption>Ngọc Hiếu Hàng Cót · Ảnh từ website nhà hàng</figcaption></figure><p>Không gian thật, những bữa ăn thật. Mời bạn ghé cơ sở mình yêu thích.</p></> : null}
                {chapter === 2 ? <><img className="signature-photo" src={`/images/${dishes[0].image}`} alt={dishes[0].name} width="700" height="800" loading="lazy" /><h3>{dishes[0].name}</h3><strong className="chapter-price">{dishes[0].price.toLocaleString('vi-VN')} ₫</strong><p>Chảo gang hình bò, bánh mì nhà làm. Giá tham khảo từ website; gọi để xác nhận giá và đặt món.</p></> : null}
                {chapter === 3 ? <><figure className="chapter-photo"><img src="/images/ngoc-hieu-social-official-atmosphere-family.jpg" alt="Không gian nhà hàng trong bài đăng chính thức của Ngọc Hiếu" width="700" height="770" loading="lazy" /><figcaption>Ảnh do nhà hàng đăng, không phải ảnh đánh giá của khách.</figcaption></figure><p>Khám phá các bài đăng và trao đổi trên kênh chính thức. Chúng tôi không hiển thị điểm sao hay trích dẫn chưa được xác minh.</p></> : null}
                {chapter === 4 ? <p>Bít tết, mỳ Ý và những món ăn cho cuộc hẹn hôm nay. Bạn chủ động mở thực đơn, hành trình không tự chuyển trang.</p> : null}
                {chapter === 5 ? <div className="story-visit"><p>Giờ trên trang hệ thống đã lưu: 07:00-22:00. Vui lòng gọi xác nhận giờ hiện tại và ưu đãi trước khi ghé.</p><a href="https://ngochieu.com.vn/he-thong-chi-nhanh.html" target="_blank" rel="noreferrer">Nguồn giờ phục vụ <ArrowUpRight size={14} /></a>{branches.map((branch, index) => <a key={branch.address} href={branchMaps[index]} target="_blank" rel="noreferrer"><MapPin size={16} />{branch.address} · {branch.area}</a>)}</div> : null}
                {chapter === 6 ? <p>Hẹn nhau một bữa ngon ở Ngọc Hiếu.</p> : null}
              </details>
            </article>
          </div>
          <p className="story-disclaimer">Không gian 3D minh họa · Ảnh thật được ghi nguồn riêng.</p>
          {!mobile ? <nav className="chapter-nav" aria-label="Các chương câu chuyện"><div className="story-progress" aria-hidden="true" />{chapterLabels.map((label, index) => <button key={label} type="button" aria-label={`Chương ${index + 1}: ${label}`} aria-current={chapter === index ? 'step' : undefined} onClick={() => seek(index)}><span>0{index + 1}</span><span className="chapter-nav-label">{label}</span></button>)}</nav> : null}
        </> : null}
      </section>}

      <section className="welcome wrap reveal" aria-label="Lời chào từ Ngọc Hiếu"><span className="welcome-symbol"><ForkKnife size={28} weight="light" /></span><p>Chảo nóng trên bàn.<br /><strong>Câu chuyện bắt đầu.</strong></p><a href="#cau-chuyen" className="round-link" aria-label="Khám phá câu chuyện Ngọc Hiếu"><ArrowDownRight size={28} /></a></section>

      <section id="cau-chuyen" className="story wrap reveal">
        <figure className="story-photo"><img src="/images/official-hang-cot-reference.jpg" alt="Hình ảnh nhà hàng Ngọc Hiếu Hàng Cót từ website chính thức" width="700" height="935" loading="lazy" decoding="async" /><figcaption>Ngọc Hiếu Hàng Cót · Ảnh từ website nhà hàng</figcaption></figure>
        <div className="story-copy"><span className="eyebrow">01 / Hương vị thân quen</span><h2>Một chiếc chảo bò.<br />Bao lần <span>gặp gỡ.</span></h2><p>Ở Ngọc Hiếu, chảo gang hình bò và bánh mì nhà làm là những điều thân quen trên bàn ăn.</p><p>Chọn món mình thích, bẻ một miếng bánh mì. Rồi dành thời gian cho người ngồi đối diện.</p><a className="text-link" href="#thuc-don">Tìm món cho bữa hẹn <ArrowRight size={20} /></a><div className="story-signature">Nhà hàng Ngọc Hiếu</div></div>
      </section>

      <section id="thuc-don" className="menu-section wrap reveal">
        <div className="section-heading"><span className="eyebrow">03 / Thực đơn Ngọc Hiếu</span><h2>Món quen, ăn là nhớ.</h2><div><p>Chọn bít tết bạn thích, hoặc đổi vị với một chảo mỳ Ý.</p><a className="text-link" href="/thuc-don">Mở quyển thực đơn <ArrowUpRight size={18} /></a></div></div>
        <div className="menu-tabs" role="group" aria-label="Lọc thực đơn">{['Tất cả', 'Bít tết', 'Mỳ Ý'].map(item => <button key={item} className={category === item ? 'active' : ''} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <div className="dish-grid">{dishes.filter(dish => category === 'Tất cả' || dish.category === category).map((dish, index) => <article className={`dish dish-${index}`} key={dish.name}>
          <div className="dish-image"><img src={`/images/${dish.image}`} alt={dish.name} width="700" height="800" loading="lazy" decoding="async" /></div>
          <div className="dish-info"><div><h3>{dish.name}</h3><p>{dish.description}</p><span className="dish-price">{dish.price.toLocaleString('vi-VN')} ₫</span></div><a className="dish-arrow" href="#dat-ban" aria-label={`Đặt bàn để thưởng thức ${dish.name}`}><ArrowUpRight size={24} /></a></div>
        </article>)}</div>
        <p className="menu-note">Giá tham khảo từ website nhà hàng, đối chiếu ngày 02/10/2026. Vui lòng liên hệ để xác nhận giá và tình trạng phục vụ. <a href="https://ngochieu.com.vn/" target="_blank" rel="noreferrer">Nguồn thực đơn <ArrowUpRight size={14} /></a> <a href="https://www.facebook.com/bittetngochieu" target="_blank" rel="noreferrer">Xem cập nhật trên Facebook <ArrowUpRight size={14} /></a></p>
      </section>

      <section className="table-section wrap reveal"><div className="table-message"><h2>Đi một mình.<br />Hay cả <span>hội bạn.</span></h2><p>Luôn có một bữa ngon để cùng nhau chia sẻ.</p><a className="button" href="#dat-ban">Đặt bàn <ArrowUpRight size={20} /></a></div><div className="table-photo"><img src="/images/pasta-meatballs.jpg" alt="Chảo mỳ Ý thịt viên tại Ngọc Hiếu" width="700" height="800" loading="lazy" decoding="async" /></div></section>

      <section className="restaurant-journal wrap" aria-labelledby="journal-title">
        <div className="journal-heading"><span className="eyebrow">Chuyện từ Ngọc Hiếu</span><h2 id="journal-title">Một góc nhà hàng.<br /><span>Một lời hẹn.</span></h2><p>Ảnh không gian và bài viết từ các kênh chính thức của nhà hàng.</p></div>
        <div className="journal-photos"><figure><img src="/images/ngoc-hieu-social-official-atmosphere-family.jpg" alt="Không gian Ngọc Hiếu trong bài viết về bữa ăn gia đình" width="700" height="770" loading="lazy" decoding="async" /><figcaption>Không gian nhà hàng · Ảnh từ Ngọc Hiếu</figcaption></figure><figure><img src="/images/official-hang-cot-railway-view.jpg" alt="Góc nhìn đường tàu từ Ngọc Hiếu theo bài giới thiệu Hàng Cót" width="700" height="933" loading="lazy" decoding="async" /><figcaption>Góc Hàng Cót · Ảnh từ Ngọc Hiếu</figcaption></figure></div>
        <div className="journal-posts"><a href="https://www.facebook.com/reel/1607893957441894/" target="_blank" rel="noreferrer"><span>Facebook · Bài đăng nhà hàng</span><h3>Pate chảo gang, bạn đã thử chưa?</h3><span>Xem bài gốc <ArrowUpRight size={18} /></span></a><a href="https://ngochieu.com.vn/l4f1aabg70xy9n8f/doi-khau-vi-cho-ca-gia-dinh-voi-nhung-thuc-don-phong-phu-tai-nha-hang-ngoc-hieu.html" target="_blank" rel="noreferrer"><span>Website · Câu chuyện nhà hàng</span><h3>Đổi khẩu vị cho cả gia đình.</h3><span>Đọc bài viết <ArrowUpRight size={18} /></span></a><a href="https://ngochieu.com.vn/l26zcbdlh8dr2l5n/bit-tet-ngoc-hieu-18-hang-cot---nha-hang-bit-tet-co-view-dep-nhat-ha-thanh.html" target="_blank" rel="noreferrer"><span>Website · Ghé Hàng Cót</span><h3>Một bữa hẹn ở 18 Hàng Cót.</h3><span>Đọc bài viết <ArrowUpRight size={18} /></span></a></div>
      </section>

      <section id="he-thong" className="branches wrap reveal"><h2>Ghé Ngọc Hiếu<br /><span>gần bạn.</span></h2><div className="branch-grid">{branches.map(branch => <a className="branch" key={branch.address} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Bít Tết Ngọc Hiếu ${branch.address} Hà Nội`)}`} target="_blank" rel="noreferrer"><MapPin size={23} weight="light" /><div><h3>{branch.address}</h3><p>{branch.area}</p></div><ArrowUpRight size={20} /></a>)}</div></section>

      <section id="dat-ban" className="booking wrap reveal"><div><span className="eyebrow">Hẹn ở Ngọc Hiếu nhé</span><h2>Bữa ngon tiếp theo,<br />có bạn.</h2><p>Gọi nhà hàng để chọn cơ sở và xác nhận bàn của bạn.</p></div><a className="booking-phone" href="tel:0933446996"><Phone size={28} weight="light" /><span>Đặt bàn<strong>0933 446 996</strong></span><ArrowUpRight size={27} /></a><details className="booking-disclosure"><summary>Gửi yêu cầu đặt bàn qua email</summary><BookingForm /></details></section>
    </main>

    <nav className="mobile-bottom-nav" aria-label="Thao tác nhanh"><a href="/thuc-don"><ForkKnife size={21} /><span>Menu</span></a><a href="tel:0933446996"><Phone size={21} /><span>Gọi</span></a><a href="#dat-ban"><ArrowUpRight size={21} /><span>Đặt bàn</span></a></nav>
    <aside className="persistent-booking" aria-label="Đặt bàn nhanh"><a className="button" href="#dat-ban">Đặt bàn <ArrowUpRight size={18} /></a><a className="persistent-call" href="tel:0933446996"><Phone size={18} /><span>0933 446 996</span></a></aside>
    <footer id="lien-he" className="footer wrap"><div className="footer-main"><a className="footer-brand" href="#home">Ngọc Hiếu<span>Bít tết & những cuộc hẹn</span></a><a href="mailto:bittetngochieu@gmail.com">bittetngochieu@gmail.com <ArrowUpRight size={18} /></a><a href="https://www.facebook.com/bittetngochieu/" target="_blank" rel="noreferrer">Facebook <ArrowUpRight size={18} /></a></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Bít Tết Ngọc Hiếu</span><span>Hẹn nhau một bữa ngon.</span></div></footer>
  </div>;
}
