/** Directions to a place: Apple Maps on iPhone/iPad, Google Maps elsewhere. */
export function directionsUrl(place: { latitude: number; longitude: number; name: string }) {
  const at = `${place.latitude},${place.longitude}`;
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
  return apple
    ? `https://maps.apple.com/?daddr=${at}&q=${encodeURIComponent(place.name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${at}`;
}
