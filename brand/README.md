# Assets de marque

| Fichier | Usage | Format |
|---|---|---|
| `arctip-banner-1500x500.png` | Bannière X / Twitter | 1500×500 |
| `banner.html` | La source qui génère le PNG ci-dessus | — |

La source est committée avec le rendu, délibérément : la bannière précédente
n'en avait aucune, et changer une seule ligne de texte a demandé de la
reconstruire entièrement.

Les polices sont lues depuis `website/fonts/`, donc `banner.html` doit être
servi (et non ouvert en `file://`) pour que les `@font-face` se chargent.

Couleurs, reprises de `website/styles.css` : navy `#14264A`, or `#C9832A`,
texte secondaire `#B9C3D6`, arc `#8A6A35`.
