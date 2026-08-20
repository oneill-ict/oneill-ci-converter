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
facturen als *posities* — de artikeltabel zonder kopblok, dus zonder klantgegevens. Nieuwe
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

## Nog niet geregeld

**Er zit geen snelheidsbegrenzing op `/api/convert`.** Iedereen die de URL kent kan het
eindpunt onbeperkt aanroepen; het is een open endpoint zonder login en elke aanroep kost
rekentijd. Instellen kan alleen via het dashboard:

Op vercel.com, bij team **oneilleurope-ict**, project **oneill-ci-converter**, onder
**Firewall**: een regel toevoegen die het pad `/api/convert` begrenst op ongeveer **60
verzoeken per minuut per IP-adres**.

De exacte knoppen noem ik hier niet, want ik heb dat dashboard niet zelf gezien en
verzonnen stappen zijn erger dan geen stappen. Twee dingen om op te letten die
onafhankelijk van de vormgeving gelden: begrens op **pad**, niet op het hele project
(anders raak je ook de website zelf), en een regel is pas actief nadat je hem hebt
gepubliceerd — opslaan alleen is niet genoeg.

60 per minuut is ruim: de zwaarste factuur in het corpus duurt 1,7 seconde, en een
normale batch is een handvol bestanden.

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
| `lib/invoice-footer.mjs` | de "Goods total"-regel, en de vergelijking daarmee |
| `lib/invoice-address.mjs` | de stad voor "DDP \<stad\>" |
| `src/App.jsx` | de voorkant |
| `src/lib/trust.js` | of een export vertrouwd mag worden, en hoe hij dan heet |
