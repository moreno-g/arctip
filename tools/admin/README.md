# Console d'administration

Outil **local**, volontairement hors de `website/` : ces boutons redirigent des
revenus et changent les frais, ils n'ont rien à faire sur un domaine public,
même derrière une vérification de wallet.

```bash
npm run admin
```

puis ouvrir http://localhost:4174/tools/admin/

Il ne signe rien lui-même : chaque action passe par le wallet connecté, donc la
clé owner reste où elle est et ne touche jamais `.env`. La page lit l'état
on-chain à chaque fois et désactive les boutons de ce qui est déjà fait — elle
ne présume rien.

Les trois appels qu'elle couvre, tous réservés au owner :

| | Appel | Pourquoi |
|---|---|---|
| 01 | `paymaster.acceptOwnership()` | Ownable2Step : la propriété est offerte, pas transférée |
| 02 | `tipJar.setTreasury(paymaster)` | Sans lui les frais ne financent jamais le sponsoring |
| 03 | `tipJar.setFeeBps(100)` | Le site annonce 1 %, le contrat doit suivre |
