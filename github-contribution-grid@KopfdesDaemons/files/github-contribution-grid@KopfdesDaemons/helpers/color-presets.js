var ColorPresetsHelper = class ColorPresetsHelper {
  static setPreset(presetName, settings) {
    switch (presetName) {
      case "default":
        settings.setValue("color-0", "#151b23");
        settings.setValue("color-1", "#033a16");
        settings.setValue("color-4", "#196c2e");
        settings.setValue("color-6", "#196c2e");
        settings.setValue("color-9", "#2ea043");
        settings.setValue("color-10", "#56d364");
        break;
      case "blue-dark":
        settings.setValue("color-0", "#151b23");
        settings.setValue("color-1", "#1a5fb4");
        settings.setValue("color-4", "#1c71d8");
        settings.setValue("color-6", "#3584e4");
        settings.setValue("color-9", "#62a0ea");
        settings.setValue("color-10", "#99c1f1");
        break;
      case "green-dark":
        settings.setValue("color-0", "#151b23");
        settings.setValue("color-1", "#26a269");
        settings.setValue("color-4", "#2ec27e");
        settings.setValue("color-6", "#33d17a");
        settings.setValue("color-9", "#57e389");
        settings.setValue("color-10", "#8ff0a4");
        break;
      case "yellow-dark":
        settings.setValue("color-0", "#151b23");
        settings.setValue("color-1", "#e5a50a");
        settings.setValue("color-4", "#f5c211");
        settings.setValue("color-6", "#f6d32d");
        settings.setValue("color-9", "#f8e45c");
        settings.setValue("color-10", "#f9f06b");
        break;
      case "orange-dark":
        settings.setValue("color-0", "#151b23");
        settings.setValue("color-1", "#c64600");
        settings.setValue("color-4", "#e66100");
        settings.setValue("color-6", "#ff7800");
        settings.setValue("color-9", "#ffa348");
        settings.setValue("color-10", "#ffbe6f");
        break;
      case "red-dark":
        settings.setValue("color-0", "#151b23");
        settings.setValue("color-1", "#a51d2d");
        settings.setValue("color-4", "#c01c28");
        settings.setValue("color-6", "#e01b24");
        settings.setValue("color-9", "#ed333b");
        settings.setValue("color-10", "#f66151");
        break;
      case "magenta-dark":
        settings.setValue("color-0", "#151b23");
        settings.setValue("color-1", "#410041");
        settings.setValue("color-4", "#6B006B");
        settings.setValue("color-6", "#960096");
        settings.setValue("color-9", "#C900C9");
        settings.setValue("color-10", "#FF00FF");
        break;
      case "purple-dark":
        settings.setValue("color-0", "#151b23");
        settings.setValue("color-1", "#613583");
        settings.setValue("color-4", "#813d9c");
        settings.setValue("color-6", "#9141ac");
        settings.setValue("color-9", "#c061cb");
        settings.setValue("color-10", "#dc8add");
        break;
      case "gruvbox-dark":
        settings.setValue("color-0", "#282828");
        settings.setValue("color-1", "#665c54");
        settings.setValue("color-4", "#bdae93");
        settings.setValue("color-6", "#bdae93");
        settings.setValue("color-9", "#ebdbb2");
        settings.setValue("color-10", "#ebdbb2");
        break;
      case "default-light":
        settings.setValue("color-0", "#EBEBEB");
        settings.setValue("color-1", "#033a16");
        settings.setValue("color-4", "#196c2e");
        settings.setValue("color-6", "#196c2e");
        settings.setValue("color-9", "#2ea043");
        settings.setValue("color-10", "#56d364");
        break;
      case "blue-light":
        settings.setValue("color-0", "#EBEBEB");
        settings.setValue("color-1", "#1a5fb4");
        settings.setValue("color-4", "#1c71d8");
        settings.setValue("color-6", "#3584e4");
        settings.setValue("color-9", "#62a0ea");
        settings.setValue("color-10", "#99c1f1");
        break;
      case "green-light":
        settings.setValue("color-0", "#EBEBEB");
        settings.setValue("color-1", "#26a269");
        settings.setValue("color-4", "#2ec27e");
        settings.setValue("color-6", "#33d17a");
        settings.setValue("color-9", "#57e389");
        settings.setValue("color-10", "#8ff0a4");
        break;
      case "yellow-light":
        settings.setValue("color-0", "#EBEBEB");
        settings.setValue("color-1", "#e5a50a");
        settings.setValue("color-4", "#f5c211");
        settings.setValue("color-6", "#f6d32d");
        settings.setValue("color-9", "#f8e45c");
        settings.setValue("color-10", "#f9f06b");
        break;
      case "orange-light":
        settings.setValue("color-0", "#EBEBEB");
        settings.setValue("color-1", "#c64600");
        settings.setValue("color-4", "#e66100");
        settings.setValue("color-6", "#ff7800");
        settings.setValue("color-9", "#ffa348");
        settings.setValue("color-10", "#ffbe6f");
        break;
      case "red-light":
        settings.setValue("color-0", "#EBEBEB");
        settings.setValue("color-1", "#a51d2d");
        settings.setValue("color-4", "#c01c28");
        settings.setValue("color-6", "#e01b24");
        settings.setValue("color-9", "#ed333b");
        settings.setValue("color-10", "#f66151");
        break;
      case "magenta-light":
        settings.setValue("color-0", "#EBEBEB");
        settings.setValue("color-1", "#410041");
        settings.setValue("color-4", "#6B006B");
        settings.setValue("color-6", "#960096");
        settings.setValue("color-9", "#C900C9");
        settings.setValue("color-10", "#FF00FF");
        break;
      case "purple-light":
        settings.setValue("color-0", "#EBEBEB");
        settings.setValue("color-1", "#613583");
        settings.setValue("color-4", "#813d9c");
        settings.setValue("color-6", "#9141ac");
        settings.setValue("color-9", "#c061cb");
        settings.setValue("color-10", "#dc8add");
        break;
      case "gruvbox-light":
        settings.setValue("color-0", "#EBEBEB");
        settings.setValue("color-1", "#665c54");
        settings.setValue("color-4", "#bdae93");
        settings.setValue("color-6", "#bdae93");
        settings.setValue("color-9", "#ebdbb2");
        settings.setValue("color-10", "#ebdbb2");
        break;
      default:
        break;
    }
  }
};
