#!/bin/bash

BASE_URL="https://chat.stkd.site"
ACCOUNT_ID=2
TOKEN="u2WQQc3o5B9zwQRJpuRmXRDT"
ESTER_ID=13

echo "Buscando conversas onde Ester é participante..."

page=1
total_removidas=0
conversas_encontradas=()

while true; do
  response=$(curl -s "${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations?page=${page}&status=all" \
    -H "api_access_token: ${TOKEN}")

  conv_ids=$(echo "$response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
convs = data.get('data', {}).get('payload', [])
for c in convs:
    print(c['id'])
" 2>/dev/null)

  if [ -z "$conv_ids" ]; then
    break
  fi

  count=$(echo "$conv_ids" | wc -l | tr -d ' ')
  echo "Página $page: $count conversas"

  while IFS= read -r conv_id; do
    [ -z "$conv_id" ] && continue

    participants=$(curl -s "${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conv_id}/participants" \
      -H "api_access_token: ${TOKEN}")

    is_participant=$(echo "$participants" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    ids = [p['id'] for p in data]
    print('yes' if ${ESTER_ID} in ids else 'no')
except:
    print('no')
" 2>/dev/null)

    if [ "$is_participant" = "yes" ]; then
      conversas_encontradas+=("$conv_id")
      echo "  → Conversa #${conv_id}: Ester é participante. Removendo..."

      result=$(curl -s -X DELETE "${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conv_id}/participants" \
        -H "api_access_token: ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"user_ids\": [${ESTER_ID}]}")

      echo "     Resultado: $result"
      ((total_removidas++))
    fi
  done <<< "$conv_ids"

  # Verifica se há mais páginas
  has_more=$(echo "$response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
convs = data.get('data', {}).get('payload', [])
print('yes' if len(convs) == 25 else 'no')
" 2>/dev/null)

  if [ "$has_more" != "yes" ]; then
    break
  fi

  ((page++))
done

echo ""
echo "==============================="
echo "Concluído!"
echo "Conversas processadas: $(( (page - 1) * 25 + count ))"
echo "Ester removida de ${total_removidas} conversas."
if [ ${#conversas_encontradas[@]} -gt 0 ]; then
  echo "IDs: ${conversas_encontradas[*]}"
fi
