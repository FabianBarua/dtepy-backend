import net.sf.jasperreports.engine.JasperCompileManager;

/**
 * Compila una plantilla .jrxml a .jasper con el JasperReports de la librería
 * facturacionelectronicapy-kude. Lo usa scripts/kude-compilar.js.
 *
 * Uso: java -cp "<jasperLibs>/*" CompilarJasper.java <entrada.jrxml> <salida.jasper>
 */
public class CompilarJasper {
  public static void main(String[] args) throws Exception {
    if (args.length != 2) {
      System.err.println("Uso: CompilarJasper <entrada.jrxml> <salida.jasper>");
      System.exit(2);
    }
    JasperCompileManager.compileReportToFile(args[0], args[1]);
  }
}
