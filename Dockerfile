FROM node:22-alpine

WORKDIR /tool
COPY --chown=node:node seed.mjs ./seed.mjs
USER node

ENTRYPOINT ["node", "seed.mjs"]
