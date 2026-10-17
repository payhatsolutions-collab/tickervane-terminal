#!/bin/zsh
cd "${0:A:h}"
viewer_node="$(command -v node)"
if [[ -z "$viewer_node" ]]; then
  viewer_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$viewer_node" ]]; then
  print 'Node.js is needed to open the local user viewer.'
  read -k 1 '?Press any key to close.'
  exit 1
fi
print 'Opening AlphaNova users at http://127.0.0.1:5188'
"$viewer_node" local-admin/server.mjs --open
read -k 1 '?Press any key to close.'
