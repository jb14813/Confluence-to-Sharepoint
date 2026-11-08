import sys
sys.path.append("../../../../../build_tools/scripts")
import base

base.configure_common_apps()

base.replaceInFile("../../../../Common/3dParty/icu/icu/source/common/udata.cpp", "\n{\n#ifdef BUILDING_WASM_MODULE\nreturn NULL;\n#endif\n    UDataMemory tData;", "\n{\n    UDataMemory tData;")
base.replaceInFile("../../../../DesktopEditor/cximage/png/pnglibconf.h", "//#define PNG_CONSOLE_IO_SUPPORTED", "#define PNG_CONSOLE_IO_SUPPORTED")


# finalize
base.replaceInFile("./deploy/drawingfile.js", "function getBinaryPromise(", "function getBinaryPromise2(")
base.replaceInFile("./deploy/drawingfile.js", "__ATPOSTRUN__=[];", "__ATPOSTRUN__=[function(){window[\"AscViewer\"] && window[\"AscViewer\"][\"onLoadModule\"] && window[\"AscViewer\"][\"onLoadModule\"]();}];")
base.replaceInFile("./deploy/drawingfile.js", "__ATPOSTRUN__ = [];", "__ATPOSTRUN__=[function(){window[\"AscViewer\"] && window[\"AscViewer\"][\"onLoadModule\"] && window[\"AscViewer\"][\"onLoadModule\"]();}];")
base.replaceInFile("./deploy/drawingfile.js", "\"drawingfile.js.mem\"", "getMemoryPathIE(\"drawingfile.js.mem\")")




base.writeFile("./deploy/drawingfile.js", base.readFile("../../../../Common/license/header.license") + base.readFile("./deploy/drawingfile.js"))
