const PRIMARY_HOSTNAME = "result-rpc.com";

export default {
  fetch(request: Request): Response {
    const destination = new URL(request.url);
    destination.protocol = "https:";
    destination.hostname = PRIMARY_HOSTNAME;
    destination.port = "";

    return Response.redirect(destination.toString(), 308);
  },
};
