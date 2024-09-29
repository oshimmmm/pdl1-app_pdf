import express from 'express'; //サーバーを立てるためのフレームワーク.APIのエンドポイントを作成したり、リクエストを処理.
import axios from 'axios'; //HTTPリクエストを送信するためのライブラリ.PDFファイルやウェブサイトのデータを取得するのに使う.
import * as cheerio from 'cheerio'; //HTMLを解析し、jQueryのようにDOM要素を操作できるライブラリ.
import pdfParse from 'pdf-parse'; //PDFファイルのテキスト内容を解析
import pkg from 'pdfjs-dist'; //PDFファイルをレンダリングするためのライブラリ.PDFのページを画像に変換するために使う.
const { getDocument, GlobalWorkerOptions } = pkg;
import cors from 'cors';
import { createCanvas } from 'canvas'; //PDFのページを画像としてレンダリングするためのライブラリ

GlobalWorkerOptions.standardFontDataUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/standard_fonts/';

// NodeCanvasFactoryの実装
// PDFのページを描画するためにキャンバスを生成・管理する役割を持つ
class NodeCanvasFactory {
  //createメソッドでcanvasを作成
  static create(width, height) {
    const canvas = createCanvas(width, height);  // canvasパッケージの createCanvas メソッドを使う
    const context = canvas.getContext('2d'); //2D描画用のコンテキストを取得.これにより、キャンバスに対して描画操作ができるようになる（たとえば、線を描く、画像を描画するなど）
    return {
      canvas: canvas,
      context: context, //描画領域
    };
  }
  
  // キャンパスをリセットするためのresetメソッド
  static reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width; //キャンバスのサイズを新たに指定された幅（width）と高さ（height）に変更.キャンバスのサイズを変更すると、描画内容はクリアされる
    canvasAndContext.canvas.height = height;
  }

  // キャンバスとそのコンテキストを破棄し、メモリを解放するdestoroyメソッド
  static destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

// expressのセットアップ
const app = express();

app.use(express.json()); // express.json()は、JSON形式のリクエストボディを解析する
app.use(cors()); // CORSを有効化。フロントエンドのポートは3000、バックエンドは5000、これが通信可能にする。

// POSTリクエストを受け取るAPIエンドポイントを設定（/api/search）
app.post('/api/search', async (req, res) => {
  const { query } = req.body; // フロントエンドから来たリクエストボディ（req.body）からquery取得。
  const url = 'https://pdl-1-pdf-html.vercel.app/'; // 対象のウェブサイトURL

  try {
    // axiosでurlのサイト内検索し、queryを含む内容を見つけてdataとして格納
    const { data } = await axios.get(url, {
      params: { q: query },
    });

    // cheerio.loadでdataの内容(HTML要素)を読み込み、$として操作できるようにする
    const $ = cheerio.load(data);

    let pdfLinks = [];
    // aタグでhref属性が.pdfで終わるリンクを選択して、そのリンクを配列pdfLinksに格納
    // 見つけたすべてのPDFリンクに対して、each()でループ処理行う
    $('a[href$=".pdf"]').each((index, element) => {
      // new URL()の使用例.
      // new URL("/files/sample.pdf", "https://example.com")とすると、https://example.com/files/sample.pdfができる。
      // HTML要素(element)をcheerioオブジェクトにして操作できるようにして、.attr('href')でリンク先のリンクを取得
      const link = new URL($(element).attr('href'), url).href;
      pdfLinks.push(link);
    });

    if (pdfLinks.length === 0) {
      return res.status(404).json({ message: 'PDFファイルが見つかりませんでした' });
    }



    let images = []; // 画像データを保存する配列

    for (const pdfUrl of pdfLinks) {
      try {
        // axiosを使ってPDFファイルのデータをarraybufferで取得
        const pdfResponse = await axios.get(pdfUrl, { responseType: 'arraybuffer' });

        let pdfData;
        // pdf-parseでPDFを解析
        try {
          pdfData = await pdfParse(pdfResponse.data);
        } catch (error) {
          console.error('PDF parsing failed:', error);
          continue; // エラーが発生した場合は次のPDFに進む
        }

        // pdfDataが存在する場合に、検索クエリをチェック
        if (pdfData && pdfData.text.includes(query)) {
          // 検索クエリが含まれる場合、そのPDFの最初のページを画像に変換
          const imageBuffer = await extractFirstPageAsImage(pdfResponse.data);
          images.push(imageBuffer);
        }
      } catch (error) {
        console.error(`Error processing PDF: ${pdfUrl}`, error);
      }
    }

    if (images.length === 0) {
      return res.status(404).json({ message: 'クエリに一致するPDFが見つかりませんでした' });
    }

    // フロントエンドにresponse返す
    // 画像データをBase64に変換してレスポンスとして返す
    const base64Images = images.map((img) => img.toString('base64'));
    res.json({ images: base64Images });

  } catch (error) {
    console.error(error);
    res.status(500).send('エラーが発生しました');
  }
});

// PDFの最初のページを画像として抽出する関数
// pdfBuffer(pdfResponse.data)を受け取る
async function extractFirstPageAsImage(pdfBuffer) {
  // getDocument はPDFデータ（pdfBuffer）を受け取り、それをPDF.jsによって処理可能な形式に変換
  // loadingTask は、PDFドキュメントの読み込みタスク.非同期処理だから、.promiseを使用して、読み込み完了を待つ必要あり
  // await loadingTask.promise で、読み込みが完了するとpdfDoc（PDFドキュメント全体のオブジェクト）が取得できる
  const loadingTask = getDocument({ data: pdfBuffer });
  const pdfDoc = await loadingTask.promise;
  const page = await pdfDoc.getPage(1); // 最初のページを取得

  // PDFページを描画する際のビュー領域を元のサイズの1.5倍に拡大して描画
  const viewport = page.getViewport({ scale: 1.5 });

  // PDFのページを描画するためのキャンバスを作成
  const canvasAndContext = NodeCanvasFactory.create(viewport.width, viewport.height);  // canvasAndContext オブジェクトには、canvas（キャンバス）とcontext（描画コンテキスト）が含まれている
  const renderContext = {
    canvasContext: canvasAndContext.context,
    viewport: viewport,
  };

  // page.render(renderContext)は、指定されたキャンバスにPDFページを描画するためのメソッド
  // 非同期処理だから、.promise を使って描画が完了するのを待つ
  await page.render(renderContext).promise;

  // キャンバスに描画されたPDFページの内容を画像データとしてバッファ（imageBuffer）に変換し、返す
  const imageBuffer = canvasAndContext.canvas.toBuffer();
  return imageBuffer;
}


app.listen(5000, () => {
  console.log('Server is running on port 5000');
});
