FROM node:16.15
WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn

COPY . ./

RUN yarn run build
EXPOSE 3000
CMD yarn run start
