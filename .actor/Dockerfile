FROM apify/actor-node-playwright-chrome:20

WORKDIR /usr/src/app

COPY --chown=myuser package*.json ./
RUN npm --quiet set progress=false \
    && npm ci --include=dev --omit=optional

COPY --chown=myuser . ./
RUN npm run build

CMD ["npm", "start"]
