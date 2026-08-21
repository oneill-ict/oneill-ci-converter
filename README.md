# Commercial Invoice Converter

Zet O'Neill Commercial Invoice PDF's om naar Excel, met tariefsubtotalen.

**Live:** https://oneill-ci-converter-lemon.vercel.app — geen login, niets wordt opgeslagen.

Dit bestand is in het Nederlands omdat het bedoeld is om onder tijdsdruk gelezen te
worden door een collega. De code en de commits zijn Engels.

---

## Er gaat iets mis met een factuur — wat nu?

**De converter weigert het bestand.** Dat is opzet. Hij levert liever niets dan een
Excel met verkeerde getallen. In het scherm staat waarom:

| Melding | Wat het betekent | Wat je doet |
|---|---|---|
| aantal of totaal komt niet overeen | Er zijn regels gemist of dubbel geteld. De artikelnummers van de gemiste regels staan eronder. | Stuur de PDF door; dit is een echte fout die uitgezocht moet worden. |
| regels ontbreken | Sommige regels waren niet leesbaar. Ze worden bij naam genoemd. | Idem. |
| het factuurtotaal kon niet worden gelezen | De "Goods total"-regel onderaan de PDF is niet gevonden, dus er is niets om tegen te controleren. | Het Excel is waarschijnlijk goed, maar niemand heeft het nagekeken. Zelf tellen of doorsturen. |
| brutogewicht ontbreekt | Eén sjabloon zet het gewicht alleen in de kop, niet per regel. Die cellen blijven **leeg** — nooit 0. | Handmatig aanvullen. |
| credit nota | Negatieve bedragen worden niet ondersteund. | Met de hand opmaken. |

**Je kunt altijd "Toch downloaden".** Het bestand krijgt dan de reden in zijn eigen
naam, bijvoorbeeld `CI_4442960 (ONVOLLEDIG).xlsx`, zodat je later nog ziet dat het niet
goedgekeurd was.

**Controleer het Excel zelf in één blik:** onderaan, onder `SUBTOTAL TARIFF NO.`, staat
een rij **`Difference`**. Daar moeten drie nullen staan. Staat er iets anders, dan telt
de tariefverdeling niet op tot de factuur en moet je het niet gebruiken.

---

## Aan de slag met de code

```bash
npm ci
npm run dev
```

Draait op http://localhost:5173. Let op: `npm run dev` start alleen de voorkant. De
omzetting zelf (`/api/convert`) draait niet lokaal — die test je met `npm test` of tegen
de live URL.

## Testen

```bash
npm test
```

Draait alles. Groen = klaar. Twee tests slaan zichzelf over als het facturencorpus er
niet is; dat is normaal en ook wat er in GitHub Actions gebeurt.

Het corpus (45 echte facturen) staat **niet** in de repository, want daar staan
klantnamen en adressen op. Wil je die tests ook draaien:

```bash
CI_CORPUS_DIR=/pad/naar/ci-training-files npm test
```

De map staat op de laptop van Sjoerd onder `Downloads/ci-training-files`.

Zonder het corpus test je nog steeds tegen echte facturen: in `test/fixtures` staan zes
facturen als *posities* — de artikeltabel zonder kopblok, dus zonder klantgegevens. Plus
één bestand met de runs *voor* het groeperen in regels, want die stap is anders door geen
enkele test gedekt; daarin zijn de labels en posities echt en de waarden vervangen. Nieuwe
maken (heeft het corpus nodig):

```bash
node make-fixtures.mjs
```

Die weigert te schrijven als er klantgegevens in het resultaat achterblijven.

## Deployen

**De GitHub-koppeling met Vercel is stuk — pushen naar `main` zet niets live.** Het gaat
met de hand, in deze volgorde:

```bash
vercel build --prod
vercel deploy --prebuilt --prod
```

Eerste keer op een nieuwe machine: `vercel login` en dan `vercel link` (team
*oneilleurope-ict*, project *oneill-ci-converter*).

Exit code 255 met alleen waarschuwingen in de uitvoer is geen fout — kijk of er
`Aliased  https://oneill-ci-converter-lemon.vercel.app` staat. Zo ja, het staat live.

Daarna zelf controleren met een echte factuur, niet alleen aannemen dat het goed ging.

---

## De snelheidsbegrenzing

Actief sinds 21 augustus 2026. `/api/convert` is een open endpoint zonder login, dus het
aantal aanroepen is begrensd:

```
Rate limit /api/convert  —  path starts with /api/convert
120 verzoeken / 60 s, per IP  —  bij overschrijding: log
```

**Hij blokkeert nog niets.** `log` betekent alleen registreren, zodat je eerst een tijdje
kunt zien of er ooit iemand in de buurt komt voordat je legitiem verkeer riskeert.
Dichtdraaien is later één commando:

```bash
vercel firewall rules edit "Rate limit /api/convert" --rate-limit-action deny --yes
vercel firewall publish
```

Bekijken wat er live staat, of iets terugdraaien:

```bash
vercel firewall rules list --expand
vercel firewall diff        # openstaande concepten
vercel firewall discard     # concepten weggooien
```

Twee dingen om te weten bij het kiezen van dat getal. **De teller loopt per IP**, en zit
het kantoor achter één uitgaand IP dan geldt de limiet voor iedereen samen — daarom 120 en
niet 60. En **de tellers zijn per regio**, dus het feitelijke totaal kan een veelvoud zijn.
Het is een bovengrens tegen misbruik, geen precieze meter. Een normale batch van tien
facturen achter elkaar is gemeten en gaat er ruim onderdoor.

Verkeer dat de firewall blokkeert wordt niet gefactureerd, en DDoS-mitigatie staat bij
Vercel standaard aan op elk plan.

## Waar de rest staat

Er is geen aparte documentatie. Waarom iets is zoals het is, staat in de commit die het
veranderde (`git log`) en in de commentaren erboven in de code. Beide gaan over de
*waarom*, niet de *wat* — dus als je iets raars ziet, lees eerst het commentaar en de
commit voor je het verbetert.

Grofweg:

| Waar | Wat |
|---|---|
| `api/convert.js` | het endpoint: bewaking, validatie, Excel |
| `lib/invoice-rows.mjs` | de artikelregels uit de tabelgeometrie van de PDF |
| `lib/invoice-header.mjs` | datum, ordernummer, factuuradres — als kolommen |
| `lib/invoice-footer.mjs` | de "Goods total"-regel, de korting en de btw, en de vergelijking daarmee |
| `lib/invoice-address.mjs` | de stad voor "DDP \<stad\>" |
| `src/App.jsx` | de voorkant |
| `src/lib/trust.js` | of een export vertrouwd mag worden, en hoe hij dan heet |
