import { expect, test } from "bun:test";
import {
  downloadNicBulkData,
  fetchNicBulkPage,
  fetchNicData,
  NIC_BULK_PRODUCTS,
  NIC_DATA_DOWNLOAD_URL,
  nicBulkDownloadUrl,
  nicBulkProductDefinition,
  parseNicBulkArchive,
  parseNicBulkPage,
  parseNicInstitutions,
  parseNicRelationships,
  parseNicTransformations,
} from "../src/index.js";
import type { SourceFetch } from "../src/types.js";

function pageHtml(): string {
  const buttons = NIC_BULK_PRODUCTS.map(
    (product) => `<li>
      <button class="btn" onclick="${product.pageAction}()">
        <span class="link-text-align-svg">${product.label}</span>
      </button>
      <span class="footnote"> 8/7/2026</span>
    </li>`,
  ).join("\n");
  const functions = NIC_BULK_PRODUCTS.map((product) => {
    const path = new URL(product.downloadUrl).pathname;
    return `function ${product.pageAction}() { window.location.href = '${path}'; }`;
  }).join("\n");
  return `<!DOCTYPE html><html><body><h1>Data Download</h1>${buttons}<script>${functions}</script></body></html>`;
}

const INSTITUTION_CSV = [
  "#ID_RSSD,NM_LGL,NM_SHORT,ENTITY_TYPE,CHTR_AUTH_CD,CHTR_TYPE_CD,ID_FDIC_CERT,ID_OCC,ID_RSSD_HD_OFF,CITY,STATE_ABBR_NM,CNTRY_NM,ZIP_CD,STREET_LINE1,STREET_LINE2,D_DT_EXIST_CMNC,D_DT_EXIST_TERM,D_DT_OPEN",
  "37,BANK OF HANCOCK COUNTY   ,BANK OF HANCOCK CTY   ,NMB,2,200,10057,0,0,SPARTA,GA,UNITED STATES   ,31087   ,12855 BROAD STREET,0,,12/31/9999 00:00:00,09/01/1904 00:00:00",
].join("\r\n");

const RELATIONSHIP_CSV = [
  "#ID_RSSD_PARENT,ID_RSSD_OFFSPRING,PCT_EQUITY,PCT_OTHER,D_DT_START,D_DT_END,D_DT_RELN_EST",
  "130,1081305,80.00,0.00,06/27/1984 00:00:00,02/14/1986 00:00:00,06/27/1984 00:00:00",
].join("\r\n");

const TRANSFORMATION_CSV = [
  "#ID_RSSD_PREDECESSOR,ID_RSSD_SUCCESSOR,D_DT_TRANS,TRNSFM_CD,ACCT_METHOD",
  "28,75026,01/01/1994 00:00:00,1,0",
].join("\r\n");

function buildStoredZip(name: string, text: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const data = new TextEncoder().encode(text);
  const crc = Bun.hash.crc32(data);
  const local = new Uint8Array(30 + nameBytes.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint32(14, crc, true);
  localView.setUint32(18, data.length, true);
  localView.setUint32(22, data.length, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);

  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint32(16, crc, true);
  centralView.setUint32(20, data.length, true);
  centralView.setUint32(24, data.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  centralView.setUint32(42, 0, true);
  central.set(nameBytes, 46);

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, 1, true);
  eocdView.setUint16(10, 1, true);
  eocdView.setUint32(12, central.length, true);
  eocdView.setUint32(16, local.length + data.length, true);

  const archive = new Uint8Array(local.length + data.length + central.length + eocd.length);
  archive.set(local, 0);
  archive.set(data, local.length);
  archive.set(central, local.length + data.length);
  archive.set(eocd, local.length + data.length + central.length);
  return archive;
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Expected an Error", { cause: error });
  }
  throw new Error("Expected a rejection");
}

test("NIC catalog lists the five verified direct CSV ZIP products", () => {
  expect(NIC_BULK_PRODUCTS.map((product) => product.product)).toEqual([
    "attributes-active",
    "attributes-closed",
    "attributes-branches",
    "relationships",
    "transformations",
  ]);
  expect(nicBulkDownloadUrl("relationships")).toBe(
    "https://www.ffiec.gov/npw/FinancialReport/ReturnRelationshipsZipFileCSV",
  );
  expect(new URL(nicBulkDownloadUrl("relationships")).search).toBe("");
  expect(() => nicBulkProductDefinition("unknown")).toThrow(RangeError);
});

test("NIC page parser validates direct actions and product refresh dates", () => {
  const page = parseNicBulkPage(pageHtml());
  expect(page.products).toHaveLength(5);
  expect(page.products[0]).toEqual({
    product: "attributes-active",
    label: "Attributes - Active",
    downloadUrl: "https://www.ffiec.gov/npw/FinancialReport/ReturnAttributesActiveZipFileCSV",
    updatedAt: "2026-08-07",
  });
});

test("NIC page parser fails closed on markup drift", () => {
  const drifted = pageHtml().replace(
    "function ReturnRelationshipsZipFileCSV()",
    "function RenamedRelationshipsDownload()",
  );
  expect(() => parseNicBulkPage(drifted)).toThrow("missing Relationships");
});

test("NIC parsers produce typed institution, relationship, and transformation rows", () => {
  const institution = parseNicInstitutions(INSTITUTION_CSV)[0];
  expect(institution?.rssdId).toBe(37);
  expect(institution?.name).toBe("BANK OF HANCOCK COUNTY");
  expect(institution?.entityType).toBe("NMB");
  expect(institution?.charterAuthorityCode).toBe(2);
  expect(institution?.charterTypeCode).toBe(200);
  expect(institution?.fdicCertificateId).toBe("10057");
  expect(institution?.occCharterId).toBeUndefined();
  expect(institution?.state).toBe("GA");
  expect(institution?.isActive).toBe(true);
  expect(institution?.openedAt).toBe("1904-09-01T00:00:00.000Z");
  expect(institution?.raw["NM_LGL"]).toBe("BANK OF HANCOCK COUNTY   ");

  const relationship = parseNicRelationships(RELATIONSHIP_CSV)[0];
  expect(relationship?.parentRssdId).toBe(130);
  expect(relationship?.offspringRssdId).toBe(1081305);
  expect(relationship?.percentHeld).toBe(80);
  expect(relationship?.startAt).toBe("1984-06-27T00:00:00.000Z");
  expect(relationship?.endAt).toBe("1986-02-14T00:00:00.000Z");

  const transformation = parseNicTransformations(TRANSFORMATION_CSV)[0];
  expect(transformation?.predecessorRssdId).toBe(28);
  expect(transformation?.successorRssdId).toBe(75026);
  expect(transformation?.transformedAt).toBe("1994-01-01T00:00:00.000Z");
});

test("NIC coercion failures warn and leave fields unset", () => {
  const malformed = INSTITUTION_CSV.replace(
    "37,BANK OF HANCOCK",
    "not-an-id,BANK OF HANCOCK",
  ).replace("09/01/1904 00:00:00", "not-a-date");
  const row = parseNicInstitutions(malformed)[0];
  expect(row?.rssdId).toBeUndefined();
  expect(row?.openedAt).toBeUndefined();
  expect(row?.warnings).toContain('#ID_RSSD is not an integer: "not-an-id"');
  expect(row?.warnings).toContain('D_DT_OPEN is not a date: "not-a-date"');
});

test("NIC CSV and ZIP parsers fail closed on truncation", async () => {
  expect(() => parseNicRelationships(`${RELATIONSHIP_CSV}\r\n1,2,3`)).toThrow("truncated row");
  const failure = await captureError(
    parseNicBulkArchive(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "relationships"),
  );
  expect(failure).toBeInstanceOf(Error);
});

test("NIC archive parser dispatches to the product record type", async () => {
  const archive = buildStoredZip("CSV_RELATIONSHIPS.CSV", RELATIONSHIP_CSV);
  const rows = await parseNicBulkArchive(archive, "relationships");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ parentRssdId: 130, offspringRssdId: 1081305 });
});

test("NIC fetchers use injected GET transport and preserve a caller User-Agent", async () => {
  const archive = buildStoredZip("CSV_ATTRIBUTES_ACTIVE.CSV", INSTITUTION_CSV);
  const calls: { url: string; method: string; userAgent: string | null }[] = [];
  const fetchStub: SourceFetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      userAgent: headers.get("User-Agent"),
    });
    if (url === NIC_DATA_DOWNLOAD_URL) {
      return Promise.resolve(
        new Response(pageHtml(), { headers: { "content-type": "text/html" } }),
      );
    }
    return Promise.resolve(
      new Response(archive.slice(), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="CSV_ATTRIBUTES_ACTIVE.zip"',
        },
      }),
    );
  };

  const page = await fetchNicBulkPage({ fetch: fetchStub, userAgent: "nic-test-agent" });
  expect(page.products[0]?.updatedAt).toBe("2026-08-07");
  const download = await downloadNicBulkData("attributes-active", {
    fetch: fetchStub,
    userAgent: "nic-test-agent",
  });
  expect(download.filename).toBe("CSV_ATTRIBUTES_ACTIVE.zip");
  expect(calls).toEqual([
    { url: NIC_DATA_DOWNLOAD_URL, method: "GET", userAgent: "nic-test-agent" },
    {
      url: nicBulkDownloadUrl("attributes-active"),
      method: "GET",
      userAgent: "nic-test-agent",
    },
  ]);
});

test("NIC data fetch uses the page stamp and skips unchanged archives", async () => {
  const archive = buildStoredZip("CSV_ATTRIBUTES_ACTIVE.CSV", INSTITUTION_CSV);
  const calls: string[] = [];
  const fetchStub: SourceFetch = (input) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    return Promise.resolve(
      url === NIC_DATA_DOWNLOAD_URL
        ? new Response(pageHtml())
        : new Response(archive.slice(), { headers: { "content-type": "application/zip" } }),
    );
  };

  const release = await fetchNicData("attributes-active", { fetch: fetchStub, limit: 1 });
  expect(release?.asOf).toBe("2026-08-07");
  expect(release?.rows[0]).toMatchObject({ rssdId: 37, entityType: "NMB" });
  expect(calls).toHaveLength(2);

  calls.length = 0;
  const skipped = await fetchNicData("attributes-active", {
    fetch: fetchStub,
    ifNewerThan: "2026-08-07",
  });
  expect(skipped).toBeUndefined();
  expect(calls).toEqual([NIC_DATA_DOWNLOAD_URL]);
});

test("NIC limit zero avoids every network request", async () => {
  let calls = 0;
  const fetchStub: SourceFetch = () => {
    calls += 1;
    return Promise.reject(new Error("unexpected request"));
  };
  expect(await fetchNicData("attributes-active", { fetch: fetchStub, limit: 0 })).toBeUndefined();
  expect(calls).toBe(0);
  expect(parseNicInstitutions("not csv", "attributes-active", 0)).toEqual([]);
});
