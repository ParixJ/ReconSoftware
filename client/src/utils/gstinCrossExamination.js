function documentIdentity(document) {
  return {
    id: document.id,
    originalName: document.originalName,
    documentType: document.documentType,
  };
}

export function crossExamineClientGstins(documents = []) {
  const groups = new Map();
  const missingDocuments = [];

  for (const document of documents) {
    const gstin = String(document.gstin || "").trim().toUpperCase();
    if (!gstin) {
      missingDocuments.push(documentIdentity(document));
      continue;
    }
    if (!groups.has(gstin)) groups.set(gstin, []);
    groups.get(gstin).push(documentIdentity(document));
  }

  const gstinGroups = [...groups.entries()].map(([gstin, groupedDocuments]) => ({
    gstin,
    documents: groupedDocuments,
  }));
  const status = documents.length === 0
    ? "empty"
    : gstinGroups.length > 1
      ? "mismatch"
      : gstinGroups.length === 0
        ? "unverified"
        : missingDocuments.length
          ? "partial"
          : "matched";

  return {
    status,
    canReconcile: status !== "mismatch",
    clientGstin: gstinGroups.length === 1 ? gstinGroups[0].gstin : null,
    documentCount: documents.length,
    identifiedCount: documents.length - missingDocuments.length,
    gstinGroups,
    missingDocuments,
  };
}
