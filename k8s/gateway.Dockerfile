FROM nginx:1.31-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx/ /etc/nginx/conf.d/
# API, static files and gateway share a pod, keeping SSR and browser assets in sync.
RUN sed -i -e 's/listen 80/listen 8080/g' -e 's|http://backend:4000|http://127.0.0.1:4000|g' -e 's|http://frontend:80|http://127.0.0.1:80|g' /etc/nginx/conf.d/*.conf
EXPOSE 8080
