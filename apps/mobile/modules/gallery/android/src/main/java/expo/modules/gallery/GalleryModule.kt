package expo.modules.gallery

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Galeriye kaydetme (JS: modules/gallery). Android 10+ MediaStore'a uygulamanın kendi eklediği dosyalar
 * için izin istemez; depolama/medya izinleri bilerek yok (bkz. app.config.ts blockedPermissions).
 * Android 9 ve öncesinde herkese açık klasöre yazmak izin gerektirdiği için desteklenmez.
 */
class GalleryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DiskortGallery")

    Function("isSupported") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q }

    AsyncFunction("save") { uri: String, name: String, mimeType: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw GalleryException("Galeriye kaydetmek için Android 10 ya da üstü gerekiyor.")
      val context = appContext.reactContext ?: throw GalleryException("Uygulama hazır değil.")
      val resolver = context.contentResolver
      val video = mimeType.startsWith("video/")
      val collection =
        if (video) MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        else MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      val folder = if (video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
        put(MediaStore.MediaColumns.RELATIVE_PATH, "$folder/Diskort")
        // Kopyalama bitene kadar galeride görünmez
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
      val target = resolver.insert(collection, values) ?: throw GalleryException("Galeride yer açılamadı.")
      try {
        val source = Uri.parse(uri)
        val input =
          if (source.scheme == null || source.scheme == "file") File(source.path ?: uri).inputStream()
          else resolver.openInputStream(source) ?: throw GalleryException("Dosya okunamadı.")
        input.use { from ->
          val out = resolver.openOutputStream(target) ?: throw GalleryException("Galeriye yazılamadı.")
          out.use { from.copyTo(it) }
        }
        resolver.update(target, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
      } catch (e: Throwable) {
        // Yarım kalan kayıt galeride boş dosya olarak kalmasın
        resolver.delete(target, null, null)
        if (e is CodedException) throw e
        throw GalleryException("Galeriye kaydedilemedi: ${e.message ?: e.javaClass.simpleName}")
      }
      target.toString()
    }
  }
}

private class GalleryException(message: String) : CodedException(message)
