FROM apify/actor-node-playwright-chrome:20

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=optional

COPY . ./
RUN npm run build

CMD ["npm", "start"]

