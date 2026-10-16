# TizenBrew Rozcestník

TizenBrew module pro chytrou televizi Samsung Smart TV (Tizen 6.0+).

## Jak přidat do TizenBrew na Samsung TV

V aplikaci **TizenBrew** na televizi otevřete správce modulů:

### Možnost 1: Přidání přes GitHub
Do pole **GitHub Module** zadejte:
```text
<vaše-uživatelské-jméno-na-githubu>/tizenbrew-rozcestnik
```

### Možnost 2: Přidání přes NPM
Pokud je balíček publikován na NPM, do pole **NPM Module** zadejte:
```text
tizenbrew-rozcestnik
```

---

## Vlastnosti modulu
- **Nativní TV D-Pad ovládání:** Plynulá navigace šipkami dálkového ovladače se zvýrazněným zlatým fokusem.
- **Podpora tlačítka Zpět / Return (10009):** Zavírání přehrávače, modal oken i návrat z podsekcí.
- **Bypass Cloudflare Turnstile:** Automatické předvyplnění tokenu pro plynulý běh na TV bez captcha záseků.
- **Zabezpečení refererů:** No-referrer politika pro externí CDN streamy a nastavení Origin pro doménu `yasuoyone.org`.
