/**
 * Locales supported by the extension.
 *
 * Add a new code here, then add the matching translation object under
 * `src/i18n/<code>.ts` and register it in `src/i18n/index.ts`. The host
 * Trimble Connect locale determines the active value at boot.
 */
export type Locale = "en" | "fi";

/**
 * Strict translation shape. Every locale file must satisfy this interface, so
 * adding a new copy entry in English without translating it to Finnish is a
 * compile-time error rather than a missing-key surprise at runtime.
 */
export interface Translations {
  appTitle: string;

  menu: {
    title: string;
  };

  status: {
    connecting: string;
    fetchingProject: string;
    requestingPermission: string;
    ready: string;
    error: string;
    loadingIfc: string;
    parsingIfc: string;
    computingFootprints: string;
    generatingOutputs: string;
    uploading: string;
    downloading: string;
    saved: string;
  };

  fileBrowser: {
    title: string;
    empty: string;
    refresh: string;
    noProject: string;
  };

  storeyList: {
    title: string;
    elevation: string;
    empty: string;
  };

  entityPicker: {
    title: string;
    selectAll: string;
    clearAll: string;
    generate: string;
    regenerate: string;
    empty: string;
    cutHeightLabel: string;
    cutHeightHint: string;
  };

  viewer: {
    panHint: string;
    snapToggle: string;
    drawAreaToggle: string;
    stopDrawing: string;
    altDisablesSnap: string;
    layersTitle: string;
    userAreasLayer: string;
    coordinateTooltip: string;
    fitToScreen: string;
    emptyState: string;
    polygonHint: string;
    polylineHint: string;
    pointHint: string;
  };

  editOverlay: {
    title: string;
    polygonHint: string;
    polylineHint: string;
    pointHint: string;
  };

  renderOptions: {
    title: string;
    labelSource: string;
    labelNone: string;
    labelName: string;
    labelLongName: string;
    fillStyle: string;
    fillNone: string;
    fillPerType: string;
    fillSingle: string;
    fillByName: string;
    singleFillColor: string;
    fontSize: string;
    strokeWidth: string;
    strokeColor: string;
    perTypeStyling: string;
  };

  selection: {
    title: string;
    type: string;
    name: string;
    longName: string;
    guid: string;
    unnamed: string;
    showFill: string;
    fillColor: string;
    resetStyle: string;
    deleteAction: string;
  };

  areas: {
    title: string;
    nameLabel: string;
    kindLabel: string;
    kindWork: string;
    kindTakt: string;
    kindOther: string;
    showLabel: string;
    labelFontSize: string;
    strokeWidth: string;
    duplicateName: string;
    emptyName: string;
    deleteConfirm: string;
    cancel: string;
    save: string;
    drawHint: string;
  };

  persistence: {
    title: string;
    uploadButton: string;
    downloadButton: string;
    versionPrompt: string;
    versionYes: string;
    versionNo: string;
    nothingToSave: string;
    modalTitle: string;
    modalHint: string;
    uploadSelected: string;
    statsObjects: string;
    statsAreas: string;
    fileNameSuffixLabel: string;
    fileNameSuffixHint: string;
  };

  savedFloorplans: {
    title: string;
    empty: string;
    refresh: string;
    loadButton: string;
    loaded: string;
    loadFailed: string;
    bothFormats: string;
    jsonOnly: string;
  };

  editArea: {
    editButton: string;
    title: string;
  };

  background: {
    title: string;
    upload: string;
    remove: string;
    opacity: string;
    rotation: string;
    width: string;
    height: string;
    mode: string;
    modeCalibrate: string;
    modeLocked: string;
    calibrateHint: string;
    aspectKeep: string;
    uploadFailed: string;
  };

  siteElements: {
    title: string;
    selectCategory: string;
    drawHint: string;
    groupLines: string;
    groupAreas: string;
    groupMarkers: string;
    groupText: string;
    rotation: string;
    size: string;
    routeWidth: string;
    routeWidthHint: string;
    radius: string;
    strokeColor: string;
    drivingRoute: string;
    fence: string;
    gate: string;
    crane: string;
    siteCabin: string;
    wasteContainer: string;
    elevator: string;
    entrance: string;
    electricalCabinet: string;
    demolitionArea: string;
    firstAid: string;
    parking: string;
    loadingArea: string;
    directionArrow: string;
    textLabel: string;
    /** Common label-color / label-position field labels reused by every
     *  drawing dialog and the selection panel. */
    labelColor: string;
    labelPosition: string;
    labelPositionCenter: string;
    labelPositionAbove: string;
    labelPositionBelow: string;
    labelPositionLeft: string;
    labelPositionRight: string;
    /** Free-text tool naming-dialog prompt. */
    textContent: string;
    elementsList: string;
    namePromptTitle: string;
    /** Polygon-area centroid-icon visibility toggle + size multiplier. */
    showIcon: string;
    iconScale: string;
  };

  pdf: {
    title: string;
    openModal: string;
    preview: string;
    paperSize: string;
    orientation: string;
    orientationPortrait: string;
    orientationLandscape: string;
    marginMm: string;
    fileNameLabel: string;
    exportButton: string;
    alwaysSavesToTrimble: string;
    saved: string;
    failed: string;
    customCrop: string;
    customCropHint: string;
    resetCrop: string;
    includeAnnotations: string;
  };

  errors: {
    workspaceApiMissing: string;
    tokenTimeout: string;
    fileLoadFailed: string;
    parseFailed: string;
    uploadFailed: string;
    pdfExportFailed: string;
  };
}
