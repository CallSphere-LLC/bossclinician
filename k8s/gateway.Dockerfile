FROM nginx:1.31-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx/ /etc/nginx/conf.d/
# API, static files and gateway share a pod, keeping SSR and browser assets in sync.
RUN sed -i -e 's/listen 80/listen 8080/g' -e 's|http://backend:4000|http://127.0.0.1:4000|g' -e 's|http://frontend:80|http://127.0.0.1:80|g' /etc/nginx/conf.d/*.conf
EXPOSE 8080

# Security baseline: writable runtime state is confined to /tmp/nginx.
RUN apk upgrade --no-cache && sed -i '/^user[[:space:]]/d; s@pid[[:space:]]*[^;]*;@pid /tmp/nginx/nginx.pid;@' /etc/nginx/nginx.conf \
    && sed -i '/http {/a\    client_body_temp_path /tmp/nginx/client_temp;\n    proxy_temp_path /tmp/nginx/proxy_temp;\n    fastcgi_temp_path /tmp/nginx/fastcgi_temp;\n    uwsgi_temp_path /tmp/nginx/uwsgi_temp;\n    scgi_temp_path /tmp/nginx/scgi_temp;' /etc/nginx/nginx.conf \
    && mkdir -p /tmp/nginx && chown -R 101:101 /tmp/nginx
USER 101:101
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
