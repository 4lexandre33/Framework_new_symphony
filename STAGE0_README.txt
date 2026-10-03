Projeto1 — Etapa 0: Congelamento do Estado de Referência

Conteúdo:
- scripts/architecture/stage0-baseline.mjs
- STAGE0_README.txt
- SHA256SUMS.txt

Extração:
  cd ~/projeto1
  unzip -o projeto1_stage0_baseline.zip -d .

Execução:
  node scripts/architecture/stage0-baseline.mjs

Verificação:
  node scripts/architecture/stage0-baseline.mjs --verify-latest

Observação:
A Etapa 0 não altera src/, src-tauri/, tests/ ou arquivos congelados.
Ela apenas cria o baseline em .migration/stage0/.
