autorest --typescript \
  --input-file=../../plugins/catalog-backend/openapi.yaml \
  --output-folder=lib/ \
  --license-header=MICROSOFT_MIT_NO_VERSION \
  --package-name=@backstage/catalog-client \
  --package-version=0.1
  --generate-metadata