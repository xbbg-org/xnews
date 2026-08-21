export type TrafficCameraNetwork =
  | "nyc"
  | "tfl"
  | "deldot"
  | "nzta"
  | "caltrans"
  | "ontario511"
  | "alberta511";

export type ImplementedTrafficCameraNetwork = "nyc" | "tfl" | "deldot" | "nzta";

export interface TrafficCameraNetworkDefinition {
  readonly name: string;
  readonly endpoint: string;
  readonly implemented: boolean;
  readonly omissionReason?: string;
}

export const NYC_TRAFFIC_CAMERAS_URL = "https://webcams.nyctmc.org/api/cameras";
export const TFL_TRAFFIC_CAMERAS_URL = "https://api.tfl.gov.uk/Place/Type/JamCam";
export const DELDOT_TRAFFIC_CAMERAS_URL = "https://tmc.deldot.gov/json/videocamera.json";
export const NZTA_TRAFFIC_CAMERAS_URL = "https://trafficnz.info/service/traffic/rest/4/cameras/all";
export const TRAFFIC_NZ_BASE_URL = "https://trafficnz.info";

/**
 * Public networks considered for this source. Unsupported networks remain in
 * the registry so consumers can distinguish a deliberate omission from an
 * unknown feed.
 */
export const TRAFFIC_CAMERA_NETWORKS = {
  nyc: {
    name: "NYC TMC",
    endpoint: NYC_TRAFFIC_CAMERAS_URL,
    implemented: true,
  },
  tfl: {
    name: "London TfL",
    endpoint: TFL_TRAFFIC_CAMERAS_URL,
    implemented: true,
  },
  deldot: {
    name: "DelDOT",
    endpoint: DELDOT_TRAFFIC_CAMERAS_URL,
    implemented: true,
  },
  nzta: {
    name: "New Zealand NZTA",
    endpoint: NZTA_TRAFFIC_CAMERAS_URL,
    implemented: true,
  },
  caltrans: {
    name: "Caltrans",
    endpoint: "https://cwwp2.dot.ca.gov/data/{district}/cctv/cctvStatus{DISTRICT}.json",
    implemented: false,
    omissionReason: "Requires twelve district requests for one directory read",
  },
  ontario511: {
    name: "Ontario 511",
    endpoint: "https://511on.ca/api/v2/get/cameras?format=json",
    implemented: false,
    omissionReason: "Canadian network deliberately excluded from this source",
  },
  alberta511: {
    name: "Alberta 511",
    endpoint: "https://511.alberta.ca/api/v2/get/cameras?format=json",
    implemented: false,
    omissionReason: "Canadian network deliberately excluded from this source",
  },
} as const satisfies Readonly<Record<TrafficCameraNetwork, TrafficCameraNetworkDefinition>>;
